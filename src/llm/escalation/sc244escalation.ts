import Anthropic from '@anthropic-ai/sdk';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { evaluate, screenshot } from '../../mcp/tools';
import { parseEvalJson } from '../../mcp/evalUtils';
import type { EscalationToolCall, SC244EscalationResult, SC244Evidence } from '../../types/finding';

const MODEL = 'claude-haiku-4-5';
const MAX_TOOL_CALLS = 10;
const MAX_ITERATIONS = 12;
const MAX_TOKENS = 2048;
const TEMPERATURE = 0;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'inspect_link_context',
    description:
      'Inspect the target link and its contextual container. Returns accessible ' +
      'name, href, role, surrounding text, and nearest heading/label clues.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        href: { type: 'string' },
        accessibleName: { type: 'string' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'inspect_element',
    description:
      'Inspect any element by selector to gather role, labels, text, and child headings.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
    },
  },
  {
    name: 'screenshot_element',
    description:
      'Capture the visual context of an element as PNG to resolve ambiguous link purpose.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
    },
  },
  {
    name: 'finalize',
    description:
      'Submit the final enriched SC 2.4.4 verdict. Call exactly once after investigation.',
    input_schema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['pass', 'fail', 'needs_review'] },
        rationale: { type: 'string' },
        uncertainty: { type: 'string', enum: ['low', 'medium', 'high'] },
        resolvedPurpose: { type: 'string' },
        contextContainer: { type: 'string' },
        rootCause: { type: 'string' },
        suggestedFix: { type: 'string' },
      },
      required: ['verdict', 'rationale', 'uncertainty', 'rootCause', 'suggestedFix'],
    },
  },
];

const SYSTEM_PROMPT =
`You are an expert WCAG 2.2 accessibility investigator for SC 2.4.4 Link Purpose (In Context).

The deterministic pass flagged a potentially ambiguous link. Investigate the live page and produce
an enriched, developer-actionable verdict.

Core rule:
- PASS when link purpose is clear from accessible name alone OR from accessible name plus programmatically
  determinable context (section heading, card title, list item label, table header, nearby descriptive text).
- FAIL when purpose is still ambiguous even after context inspection.
- NEEDS_REVIEW when evidence remains mixed/insufficient.

Investigation workflow:
1. Call inspect_link_context on the target link.
2. If needed, inspect parent/ancestor containers or related heading elements.
3. Capture one screenshot (target link or context container) when visual grouping is relevant.
4. Call finalize.

Constraints:
- Do not navigate/reload/click links.
- Do not rely on URL slug alone to infer purpose.
- Keep tool usage concise; budget is ${MAX_TOOL_CALLS} calls.

Respond only via tool calls. End by calling finalize exactly once.`;

type ToolDispatchResult = {
  text: string;
  image?: { data: string; mime: string };
};

const INSPECT_ELEMENT_JS = (selector: string) => `() => {
  function getSelector(node) {
    if (!node) return null;
    if (node.id) return node.tagName.toLowerCase() + '#' + CSS.escape(node.id);
    var parts = [];
    var cur = node;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      var part = cur.tagName.toLowerCase();
      var p = cur.parentElement;
      if (p) {
        var sameTag = Array.prototype.filter.call(p.children,
          function (s) { return s.tagName === cur.tagName; });
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function textOf(el) {
    return ((el && el.textContent) || '').replace(/\\s+/g, ' ').trim();
  }

  var sel = ${JSON.stringify(selector)};
  var el = null;
  try { el = document.querySelector(sel); } catch (_e) { el = null; }
  if (!el) return { found: false, selectorTried: sel };

  var heading = el.querySelector('h1,h2,h3,h4,h5,h6');
  var rect = el.getBoundingClientRect();

  return {
    found: true,
    selector: getSelector(el),
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || null,
    ariaLabel: el.getAttribute('aria-label') || null,
    ariaLabelledby: el.getAttribute('aria-labelledby') || null,
    text: textOf(el).slice(0, 700),
    nearestHeading: heading ? textOf(heading).slice(0, 200) : null,
    childLinks: el.querySelectorAll('a[href], area[href]').length,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    },
  };
}`;

const INSPECT_LINK_CONTEXT_JS = (
  selector: string,
  href: string,
  accessibleName: string,
) => `() => {
  function normalize(s) {
    return String(s || '').replace(/\\s+/g, ' ').trim();
  }

  function resolveAriaLabelledby(el) {
    var ids = (el.getAttribute('aria-labelledby') || '').trim();
    if (!ids) return '';
    return ids.split(/\\s+/)
      .map(function(id) {
        var ref = document.getElementById(id);
        return ref ? normalize(ref.textContent || '') : '';
      })
      .filter(Boolean)
      .join(' ');
  }

  function getAccessibleName(el) {
    return normalize(
      resolveAriaLabelledby(el) ||
      el.getAttribute('aria-label') ||
      el.textContent ||
      el.getAttribute('title') ||
      ''
    );
  }

  function getSelector(node) {
    if (node.id) return node.tagName.toLowerCase() + '#' + CSS.escape(node.id);
    var parts = [];
    var cur = node;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      var part = cur.tagName.toLowerCase();
      var p = cur.parentElement;
      if (p) {
        var sameTag = Array.prototype.filter.call(p.children,
          function (s) { return s.tagName === cur.tagName; });
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function textOf(el, limit) {
    return normalize((el.textContent || '')).slice(0, limit || 700);
  }

  var input = {
    selector: ${JSON.stringify(selector)},
    href: ${JSON.stringify(href)},
    accessibleName: ${JSON.stringify(accessibleName)},
  };

  var link = null;
  try {
    link = document.querySelector(input.selector);
  } catch (_e) {
    link = null;
  }

  if (!link && input.href) {
    var byHref = Array.prototype.filter.call(
      document.querySelectorAll('a[href], area[href]'),
      function (el) { return (el.getAttribute('href') || '') === input.href; }
    );
    if (byHref.length > 0) link = byHref[0];
  }

  if (!link && input.accessibleName) {
    var nameNeedle = normalize(input.accessibleName).toLowerCase();
    var byName = Array.prototype.filter.call(
      document.querySelectorAll('a[href], area[href]'),
      function (el) { return getAccessibleName(el).toLowerCase() === nameNeedle; }
    );
    if (byName.length > 0) link = byName[0];
  }

  if (!link) {
    return {
      found: false,
      selectorTried: input.selector,
      hrefTried: input.href,
      accessibleNameTried: input.accessibleName,
    };
  }

  var linkName = getAccessibleName(link);
  var context =
    link.closest('article, section, li, td, th, figure, figcaption, nav, main, aside, div') ||
    link.parentElement;

  var heading = null;
  if (context) {
    heading = context.querySelector('h1,h2,h3,h4,h5,h6');
  }
  if (!heading) {
    heading = link.closest('section,article,main,aside')?.querySelector('h1,h2,h3,h4,h5,h6') || null;
  }

  return {
    found: true,
    link: {
      selector: getSelector(link),
      tag: link.tagName.toLowerCase(),
      role: link.getAttribute('role') || link.tagName.toLowerCase(),
      href: link.getAttribute('href') || '',
      accessibleName: linkName,
      text: textOf(link, 300),
    },
    context: context
      ? {
          selector: getSelector(context),
          tag: context.tagName.toLowerCase(),
          text: textOf(context, 1000),
          childLinks: context.querySelectorAll('a[href], area[href]').length,
        }
      : null,
    nearestHeading: heading ? textOf(heading, 220) : null,
  };
}`;

async function dispatchTool(
  mcp: Client,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolDispatchResult> {
  switch (name) {
    case 'inspect_link_context': {
      const selector = String(input['selector'] ?? '');
      const href = String(input['href'] ?? '');
      const accessibleName = String(input['accessibleName'] ?? '');
      const raw = await evaluate(mcp, INSPECT_LINK_CONTEXT_JS(selector, href, accessibleName));
      const parsed = parseEvalJson<unknown>(raw);
      return { text: JSON.stringify(parsed) };
    }
    case 'inspect_element': {
      const selector = String(input['selector'] ?? '');
      const raw = await evaluate(mcp, INSPECT_ELEMENT_JS(selector));
      const parsed = parseEvalJson<unknown>(raw);
      return { text: JSON.stringify(parsed) };
    }
    case 'screenshot_element': {
      const selector = String(input['selector'] ?? '');
      const img = await screenshot(mcp, { element: selector, selector });
      if (!img) return { text: JSON.stringify({ error: 'screenshot_failed' }) };
      return {
        text: 'screenshot of ' + selector,
        image: { data: img.data, mime: img.mimeType },
      };
    }
    default:
      return { text: JSON.stringify({ error: 'unknown_tool', name }) };
  }
}

function buildKickoffMessage(evidence: SC244Evidence, selector: string): string {
  return (
    'A potential SC 2.4.4 link-purpose issue was detected.\n\n' +
    'Deterministic evidence summary:\n' +
    '- selector: ' + selector + '\n' +
    '- accessibleName: ' + JSON.stringify(evidence.accessibleName) + '\n' +
    '- href: ' + JSON.stringify(evidence.linkHref) + '\n' +
    '- surroundingContext: ' + JSON.stringify(evidence.surroundingContext) + '\n\n' +
    'Investigate this specific link in live DOM context and then call `finalize`.'
  );
}

function buildFallback(
  reason: string,
  transcript: EscalationToolCall[],
  toolCallCount: number,
): SC244EscalationResult {
  return {
    verdict: 'needs_review',
    rationale: 'Escalation incomplete: ' + reason,
    uncertainty: 'high',
    resolvedPurpose: '',
    contextContainer: null,
    rootCause: 'unknown - escalation did not finalize',
    suggestedFix: 'Manual review required',
    toolCallCount,
    transcript,
  };
}

function parseFinalizeInput(
  input: Record<string, unknown>,
  transcript: EscalationToolCall[],
  toolCallCount: number,
): SC244EscalationResult {
  const sanitize = (s: string): string => {
    const m = s.match(/<\/?[a-zA-Z][\w:-]*[^>]*>/);
    return (m ? s.slice(0, m.index) : s).trim();
  };

  const verdict = (input['verdict'] as SC244EscalationResult['verdict']) ?? 'needs_review';
  const uncertainty =
    (input['uncertainty'] as SC244EscalationResult['uncertainty']) ?? 'medium';

  return {
    verdict,
    rationale: sanitize(String(input['rationale'] ?? '')),
    uncertainty,
    resolvedPurpose: sanitize(String(input['resolvedPurpose'] ?? '')),
    contextContainer:
      typeof input['contextContainer'] === 'string'
        ? (input['contextContainer'] as string)
        : null,
    rootCause: sanitize(String(input['rootCause'] ?? '')),
    suggestedFix: sanitize(String(input['suggestedFix'] ?? '')),
    toolCallCount,
    transcript,
  };
}

let _client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export async function escalateSC244Finding(
  mcp: Client,
  evidence: SC244Evidence,
  selector: string,
): Promise<SC244EscalationResult> {
  const transcript: EscalationToolCall[] = [];
  let toolCallCount = 0;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildKickoffMessage(evidence, selector) },
  ];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      return buildFallback(
        'model returned text without calling finalize',
        transcript,
        toolCallCount,
      );
    }

    const finalizeCall = toolUses.find(t => t.name === 'finalize');
    if (finalizeCall) {
      return parseFinalizeInput(
        finalizeCall.input as Record<string, unknown>,
        transcript,
        toolCallCount,
      );
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      if (toolCallCount >= MAX_TOOL_CALLS) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: 'Tool budget exhausted. Call `finalize` now with current evidence.',
          is_error: true,
        });
        continue;
      }

      toolCallCount++;
      try {
        const input = (tu.input ?? {}) as Record<string, unknown>;
        const r = await dispatchTool(mcp, tu.name, input);
        transcript.push({
          tool: tu.name,
          input,
          resultSummary: r.text.slice(0, 240),
        });

        if (r.image) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: [
              { type: 'text', text: r.text },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: r.image.mime as 'image/png',
                  data: r.image.data,
                },
              },
            ],
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: r.text,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        transcript.push({
          tool: tu.name,
          input: (tu.input ?? {}) as Record<string, unknown>,
          resultSummary: 'ERROR: ' + msg,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: 'Error: ' + msg,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return buildFallback(
    'max iterations (' + MAX_ITERATIONS + ') reached without finalize',
    transcript,
    toolCallCount,
  );
}