import Anthropic from '@anthropic-ai/sdk';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { evaluate, pressKey } from '../../mcp/tools';
import { parseEvalJson } from '../../mcp/evalUtils';
import type { SC212Evidence, SC212EscalationResult, EscalationToolCall } from '../../types/finding';

const MODEL = 'claude-haiku-4-5';
const MAX_TOOL_CALLS = 10;
const MAX_ITERATIONS = 14;
const MAX_TOKENS = 1536;
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
            'Selector of the actual trap container if known, not only the focused element.',
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
SC 2.1.2 detector flagged a potential keyboard trap. Your job is to investigate
the live page using the provided tools and produce an enriched, developer-
actionable finding.

SC 2.1.2 says that if keyboard focus can be moved to a component using a
keyboard interface, focus must be movable away from that component using only
a keyboard interface.

Use the tools to verify the current focused element and try keyboard exits.
Check Escape and Shift+Tab. If the trap appears to be a small cycle, walk the
cycle with Tab and verify whether focus can leave or whether activation of an
appropriate control dismisses the component.

Verdict logic:
- fail: focus cannot leave the component using keyboard alone.
- pass: focus is intentionally constrained but a keyboard exit/dismissal works.
- needs_review: evidence is incomplete, mixed, or ambiguous.

You have at most ${MAX_TOOL_CALLS} tool calls. Call finalize once when done.
Respond ONLY by calling tools.`;

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

// Tool dispatcher

interface DispatchResult {
  text: string;
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
    case 'press_key': {
      const key = String(input['key'] ?? '');
      await pressKey(mcp, key);
      const raw = await evaluate(mcp, INSPECT_FOCUSED_JS);
      const parsed = parseEvalJson<unknown>(raw);
      return { text: JSON.stringify({ keyPressed: key, focusedAfter: parsed }) };
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
    '- trapType: ' + (ev.trapType ?? '(none)') + '\n' +
    (ev.cycleSelectors
      ? '- cycleSelectors:\n' +
        ev.cycleSelectors.map(s => '    * ' + s).join('\n') + '\n'
      : '') +
    '- escapeBehavior: ' + ev.escapeBehavior + '\n' +
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
  const verdict = (input['verdict'] as SC212EscalationResult['verdict']) ?? 'needs_review';
  const uncertainty =
    (input['uncertainty'] as SC212EscalationResult['uncertainty']) ?? 'medium';

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
    rationale: String(input['rationale'] ?? ''),
    uncertainty,
    trapLocation:
      typeof input['trapLocation'] === 'string'
        ? (input['trapLocation'] as string)
        : null,
    escapeAttempts,
    occlusion: null,
    rootCause: String(input['rootCause'] ?? ''),
    suggestedFix: String(input['suggestedFix'] ?? ''),
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
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: r.text,
        });
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