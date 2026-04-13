import Anthropic from '@anthropic-ai/sdk';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { evaluate, pressKey, screenshot } from '../../mcp/tools';
import { parseEvalJson } from '../../mcp/evalUtils';
import type { SC212Evidence, SC212EscalationResult, EscalationToolCall } from '../../types/finding';

const MODEL = 'claude-haiku-4-5';
const MAX_TOOL_CALLS = 12;
const MAX_ITERATIONS = 16;
const MAX_TOKENS = 2048;
const TEMPERATURE = 0;

// Tool schemas (Anthropic format)

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'inspect_focused_element',
    description:
      'Returns details about the element that currently has keyboard focus: ' +
      'selector, tag, role, accessible name, ARIA attributes, tabindex, ' +
      'bounding rect, and whether it sits inside a [role=dialog] / ' +
      '[aria-modal=true] / <dialog> ancestor.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'inspect_element',
    description:
      'Inspect any element by CSS selector. Returns the same shape as ' +
      'inspect_focused_element plus a list of focusable descendants ' +
      '(useful to see what is inside a custom-element trap container).',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
    },
  },
  {
    name: 'find_overlapping_elements',
    description:
      'Find fixed/sticky-positioned elements whose bounding rect intersects ' +
      'the target element. Detects when a cookie banner or sticky overlay ' +
      'visually covers a (potential) modal trap.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
    },
  },
  {
    name: 'press_key',
    description:
      'Press a key (Tab, Shift+Tab, Escape, Enter, ArrowDown, etc.) and ' +
      'return the new focused element after the press.',
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
  },
  {
    name: 'screenshot_element',
    description:
      'Take a PNG screenshot cropped to a single element. Use to visually ' +
      'confirm what the trap looks like and whether anything covers it.',
    input_schema: {
      type: 'object',
      properties: { selector: { type: 'string' } },
      required: ['selector'],
    },
  },
  {
    name: 'finalize',
    description:
      'Submit the final enriched verdict. Call exactly once when investigation ' +
      'is complete. After this no further tool calls are accepted.',
    input_schema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['pass', 'fail', 'needs_review'] },
        rationale: { type: 'string' },
        uncertainty: { type: 'string', enum: ['low', 'medium', 'high'] },
        trapLocation: {
          type: 'string',
          description:
            'Selector of the actual trap container (e.g. the modal dialog), ' +
            'NOT just the focusable wrapper element.',
        },
        escapeAttempts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              movedFocus: { type: 'boolean' },
              newSelector: { type: 'string' },
            },
            required: ['key', 'movedFocus'],
          },
        },
        occlusion: {
          type: 'object',
          properties: {
            isOccluded: { type: 'boolean' },
            occludingSelector: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['isOccluded', 'description'],
        },
        rootCause: { type: 'string' },
        suggestedFix: { type: 'string' },
      },
      required: ['verdict', 'rationale', 'uncertainty', 'rootCause', 'suggestedFix'],
    },
  },
];

// System prompt

const SYSTEM_PROMPT =
`You are an expert WCAG 2.2 accessibility investigator. The deterministic
detector flagged a potential SC 2.1.2 keyboard trap. Your job is to investigate
the live page using the provided tools and produce an enriched, developer-
actionable finding.

SC 2.1.2 applies per component: if keyboard focus can be moved to a component
using the keyboard, focus must be movable away from that component using only
the keyboard.

Use the tools to inspect the focused element, walk the focus order, test
Escape and Shift+Tab, inspect likely containers, and check whether fixed or
sticky elements visually cover the trap. For cycle traps, verify the whole
ring instead of assuming that one working button is enough.

Verdict logic:
- fail: focus cannot leave a focused component using keyboard alone.
- pass: focus restriction is legitimate and every focusable member has a
  keyboard mechanism to move away or dismiss the region.
- needs_review: evidence is incomplete, mixed, or ambiguous.

You have at most ${MAX_TOOL_CALLS} tool calls. Plan a short investigation,
then call "finalize" once.

Respond ONLY by calling tools. The investigation ends when you call "finalize".`;

// In-page JS snippets

const INSPECT_FOCUSED_JS = `() => {
  function getSelector(node) {
    if (node.id) return node.tagName.toLowerCase() + '#' + CSS.escape(node.id);
    var parts = [];
    var cur = node;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      var part = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(part + '#' + CSS.escape(cur.id)); break; }
      var p = cur.parentElement;
      if (p) {
        var sameTag = Array.prototype.filter.call(p.children,
          function (s) { return s.tagName === cur.tagName; });
        if (sameTag.length > 1)
          part += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  var el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  var rect = el.getBoundingClientRect();
  var dialog = el.closest('[role="dialog"], [aria-modal="true"], dialog');
  return {
    selector: getSelector(el),
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || null,
    accessibleName:
      el.getAttribute('aria-label') ||
      (el.textContent || '').trim().slice(0, 120) || null,
    ariaModal: el.getAttribute('aria-modal'),
    ariaHidden: el.getAttribute('aria-hidden'),
    tabindex: el.getAttribute('tabindex'),
    rect: { x: Math.round(rect.x), y: Math.round(rect.y),
            w: Math.round(rect.width), h: Math.round(rect.height) },
    insideDialog: dialog ? getSelector(dialog) : null,
  };
}`;

function inspectElementJs(selector: string): string {
  const sel = JSON.stringify(selector);
  return `() => {
    var el = document.querySelector(${sel});
    if (!el) return { error: 'not_found' };
    var rect = el.getBoundingClientRect();
    var dialog = el.closest('[role="dialog"], [aria-modal="true"], dialog');
    var focusableSel = 'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    var all = el.querySelectorAll(focusableSel);
    var descendants = Array.prototype.slice.call(all).slice(0, 20).map(function (n) {
      return {
        tag: n.tagName.toLowerCase(),
        id: n.id || null,
        role: n.getAttribute('role') || null,
        name: n.getAttribute('aria-label')
              || (n.textContent || '').trim().slice(0, 60) || null,
        tabindex: n.getAttribute('tabindex'),
      };
    });
    return {
      selector: ${sel},
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || null,
      accessibleName: el.getAttribute('aria-label')
                      || (el.textContent || '').trim().slice(0, 120) || null,
      ariaModal: el.getAttribute('aria-modal'),
      ariaHidden: el.getAttribute('aria-hidden'),
      hidden: el.hasAttribute('hidden'),
      tabindex: el.getAttribute('tabindex'),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y),
              w: Math.round(rect.width), h: Math.round(rect.height) },
      insideDialog: dialog && dialog !== el
        ? (dialog.id ? '#' + dialog.id : dialog.tagName.toLowerCase()) : null,
      focusableDescendants: descendants,
      focusableDescendantCount: all.length,
    };
  }`;
}

function findOverlappingJs(selector: string): string {
  const sel = JSON.stringify(selector);
  return `() => {
    var target = document.querySelector(${sel});
    if (!target) return { error: 'not_found' };
    var tr = target.getBoundingClientRect();
    var hits = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n === target || target.contains(n) || n.contains(target)) continue;
      var cs = getComputedStyle(n);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      var r = n.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      var overlap = !(r.right < tr.left || r.left > tr.right
                   || r.bottom < tr.top || r.top > tr.bottom);
      if (!overlap) continue;
      hits.push({
        tag: n.tagName.toLowerCase(),
        id: n.id || null,
        cls: typeof n.className === 'string'
          ? n.className.trim().split(/\\s+/).slice(0, 3).join('.') : null,
        zIndex: cs.zIndex,
        position: cs.position,
        rect: { x: Math.round(r.x), y: Math.round(r.y),
                w: Math.round(r.width), h: Math.round(r.height) },
      });
      if (hits.length >= 10) break;
    }
    return { target: ${sel}, overlappingCount: hits.length, overlapping: hits };
  }`;
}

// Tool dispatcher

interface DispatchResult {
  text: string;
  image?: { data: string; mime: string };
}

async function dispatchTool(
  mcp: Client,
  name: string,
  input: Record<string, unknown>,
): Promise<DispatchResult> {
  switch (name) {
    case 'inspect_focused_element': {
      const raw = await evaluate(mcp, INSPECT_FOCUSED_JS);
      const parsed = parseEvalJson<unknown>(raw);
      return { text: JSON.stringify(parsed) };
    }
    case 'inspect_element': {
      const sel = String(input['selector'] ?? '');
      const raw = await evaluate(mcp, inspectElementJs(sel));
      const parsed = parseEvalJson<unknown>(raw);
      return { text: JSON.stringify(parsed) };
    }
    case 'find_overlapping_elements': {
      const sel = String(input['selector'] ?? '');
      const raw = await evaluate(mcp, findOverlappingJs(sel));
      const parsed = parseEvalJson<unknown>(raw);
      return { text: JSON.stringify(parsed) };
    }
    case 'press_key': {
      const key = String(input['key'] ?? '');
      await pressKey(mcp, key);
      const raw = await evaluate(mcp, INSPECT_FOCUSED_JS);
      const parsed = parseEvalJson<unknown>(raw);
      return { text: JSON.stringify({ keyPressed: key, focusedAfter: parsed }) };
    }
    case 'screenshot_element': {
      const sel = String(input['selector'] ?? '');
      const img = await screenshot(mcp, { element: sel, selector: sel });
      if (!img) return { text: JSON.stringify({ error: 'screenshot_failed' }) };
      return {
        text: 'screenshot of ' + sel,
        image: { data: img.data, mime: img.mimeType },
      };
    }
    default:
      return { text: JSON.stringify({ error: 'unknown_tool', name }) };
  }
}

// Helpers

function buildKickoffMessage(stuckSelector: string | null, ev: SC212Evidence): string {
  return (
    'A potential SC 2.1.2 keyboard trap was detected on this page.\n\n' +
    'Deterministic evidence summary:\n' +
    '- stuckSelector (currently focused): ' + (stuckSelector ?? '(none)') + '\n' +
    '- trapDetected: ' + ev.trapDetected + '\n' +
    '- trapType: ' + (ev.trapType ?? '(none)') +
      (ev.trapType === 'cycle'
        ? '  <-- focus loops through a small ring; test button activation per W3C'
        : ev.trapType === 'consecutive'
          ? '  <-- same selector ' + '>=3 times in a row; likely real trap'
          : '') + '\n' +
    (ev.cycleSelectors
      ? '- cycleSelectors (the full ring; stuckSelector is just whichever was ' +
        'focused when the threshold tripped):\n' +
        ev.cycleSelectors.map(s => '    * ' + s).join('\n') + '\n'
      : '') +
    '- escapeBehavior: ' + ev.escapeBehavior +
      '  ("moved" means focus left the trap REGION, not just walked the ring)\n' +
    '- shiftTabBehavior: ' + ev.shiftTabBehavior + '\n' +
    '- totalTabsPressed: ' + ev.totalTabsPressed + '\n' +
    '- uniqueSelectorsCount: ' + ev.uniqueSelectorsCount + '\n' +
    '- totalPageFocusable: ' + ev.totalPageFocusable + '\n\n' +
    'The browser is on the page. Focus may currently be on or near the stuck ' +
    'element. Investigate using your tools, then call `finalize`.'
  );
}

function buildFallback(
  reason: string,
  transcript: EscalationToolCall[],
  toolCallCount: number,
): SC212EscalationResult {
  return {
    verdict: 'needs_review',
    rationale: 'Escalation incomplete: ' + reason,
    uncertainty: 'high',
    trapLocation: null,
    escapeAttempts: [],
    occlusion: null,
    rootCause: 'unknown — escalation did not finalize',
    suggestedFix: 'Manual review required',
    toolCallCount,
    transcript,
  };
}

function parseFinalizeInput(
  input: Record<string, unknown>,
  transcript: EscalationToolCall[],
  toolCallCount: number,
): SC212EscalationResult {
  // Sanitizer: Haiku-4.5 seems to leak tool-call XML syntax into string field values
  const sanitize = (s: string): string => {
    const m = s.match(/<\/?[a-zA-Z][\w:-]*[^>]*>/);
    return (m ? s.slice(0, m.index) : s).trim();
  };

  const verdict = (input['verdict'] as SC212EscalationResult['verdict']) ?? 'needs_review';
  const uncertainty =
    (input['uncertainty'] as SC212EscalationResult['uncertainty']) ?? 'medium';

  const occlIn = input['occlusion'] as Record<string, unknown> | undefined;
  const occlusion = occlIn
    ? {
        isOccluded: Boolean(occlIn['isOccluded']),
        occludingSelector:
          typeof occlIn['occludingSelector'] === 'string'
            ? (occlIn['occludingSelector'] as string)
            : null,
        description: sanitize(String(occlIn['description'] ?? '')),
      }
    : null;

  const attemptsIn = Array.isArray(input['escapeAttempts'])
    ? (input['escapeAttempts'] as Array<Record<string, unknown>>)
    : [];
  const escapeAttempts = attemptsIn.map(a => ({
    key: String(a['key'] ?? ''),
    movedFocus: Boolean(a['movedFocus']),
    newSelector:
      typeof a['newSelector'] === 'string' ? (a['newSelector'] as string) : null,
  }));

  return {
    verdict,
    rationale: sanitize(String(input['rationale'] ?? '')),
    uncertainty,
    trapLocation:
      typeof input['trapLocation'] === 'string'
        ? (input['trapLocation'] as string)
        : null,
    escapeAttempts,
    occlusion,
    rootCause: sanitize(String(input['rootCause'] ?? '')),
    suggestedFix: sanitize(String(input['suggestedFix'] ?? '')),
    toolCallCount,
    transcript,
  };
}

// Main entry point

let _client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export async function escalateSC212Finding(
  mcp: Client,
  evidence: SC212Evidence,
  stuckSelector: string | null,
): Promise<SC212EscalationResult> {
  const transcript: EscalationToolCall[] = [];
  let toolCallCount = 0;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildKickoffMessage(stuckSelector, evidence) },
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
          content: 'Tool budget exhausted. Call `finalize` now with whatever you have.',
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