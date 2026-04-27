import Anthropic from '@anthropic-ai/sdk';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { evaluate, pressKey, screenshot } from '../../mcp/tools';
import { parseEvalJson } from '../../mcp/evalUtils';
import type { SC212Evidence, SC212EscalationResult, EscalationToolCall } from '../../types/finding';

const MODEL = 'claude-haiku-4-5';
const MAX_TOOL_CALLS = 14;
const MAX_ITERATIONS = 18;
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
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
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
      required: ['verdict', 'rationale', 'confidence', 'rootCause', 'suggestedFix'],
    },
  },
];

// System prompt

const SYSTEM_PROMPT =
`You are an expert WCAG 2.2 accessibility investigator. The deterministic
detector flagged a potential SC 2.1.2 keyboard trap. Your job is to investigate
the live page using the provided tools and produce an enriched, developer-
actionable finding.

CRITICAL — read this before deciding:

SC 2.1.2 applies PER COMPONENT. The exact W3C wording is: "If keyboard focus
can be moved TO a component of the page using a keyboard interface, then
focus can be moved AWAY from that component using only a keyboard interface."
Every focusable element in the cycle is its own "component". Each one must
have a working keyboard exit, in BOTH navigation directions (Tab AND
Shift+Tab) OR via a documented activation that frees focus FROM THAT
ELEMENT.

Restricting focus to a subsection is allowed only if the user can untrap
themselves from EVERY focusable element in that subsection via:
  - pressing Escape, OR
  - Tab / Shift+Tab moving focus to another element (inside or outside the
    region), OR
  - activating the focused element with Enter / Space and that activation
    moves focus elsewhere or dismisses the region, OR
  - a documented non-standard mechanism.

It IS a violation when ANY of the following is true for ANY focusable ring
member:
  - Tab does not move focus AND Shift+Tab does not move focus AND the
    element cannot be activated to free focus (Enter/Space is a no-op or
    keeps focus on the same element).
  - The element is non-interactive (e.g. a <div> with tabindex but no
    keypress handler, no Enter/Space action) AND Shift+Tab from it has no
    effect — even if a sibling button elsewhere in the ring has a working
    exit. Per-component requirement is per-element.
  - The user must use the mouse to exit.

Two trap types you may see:
  - "consecutive": focus stuck on ONE element for 3+ Tabs in a row. Almost
    always a real bug. Likely fail.
  - "cycle": focus loops through a small ring of elements (e.g. 3-5 button
    cookie banner). NOT automatically a violation, but NOT automatically
    OK either — you must verify EVERY ring member has a working
    per-element exit.

Investigation workflow for "cycle" traps (do all of these before deciding):
  1. inspect_focused_element — identify what's currently focused.
  2. Walk the ring once with Tab, inspect_focused_element after each press.
     For any non-button ring member (e.g. a <div>, a scrollable region, a
     tabindex=0 wrapper), TEST Shift+Tab from that element specifically:
     does focus actually leave it? If focus stays on the same selector,
     that element is a per-component trap → fail.
  3. For at least one safe-looking button in the ring (Reject, Cancel,
     Close — AVOID Accept on cookie banners; prefer Reject), press Enter
     and inspect_focused_element to confirm it dismisses or moves focus
     out.
  4. Verdict logic:
     - If a non-interactive ring member dead-ends Shift+Tab with no
       per-element escape (Enter/Space does nothing, focus does not
       move) → verdict=fail. Cite the offending selector. The fact that
       a separate button elsewhere has an Enter exit does NOT cure the
       per-component violation.
     - If every ring member either has a working Tab/Shift+Tab move OR
       a working activation exit → verdict=pass.
     - Mixed / ambiguous → verdict=needs_review with explicit reason.

You have at most ${MAX_TOOL_CALLS} tool calls. Plan a short investigation,
then call \`finalize\` once.

Investigation goals — answer ALL in your final \`finalize\` call:
  1. Confirmed verdict: pass | fail | needs_review.
  2. trapLocation: the actual trap CONTAINER (e.g. the modal/dialog or
     cookie banner wrapper), not just the focusable wrapper.
  3. escapeAttempts: which keys you tried (Escape, Tab, Shift+Tab, Enter on
     specific buttons) and whether each one moved focus out / dismissed.
  4. occlusion: is anything visually covering the trap? Use
     find_overlapping_elements and screenshot_element to check.
  5. rootCause: 1–2 sentences. For cycle-traps that pass: name the
     legitimate restriction AND confirm every ring member has a
     per-component exit (e.g. "Cookie banner restricts focus to 3
     buttons; each is keyboard activatable; Enter on Reject dismisses
     — compliant"). For real failures: name the offending selector and
     why focus cannot leave THAT element via keyboard (e.g. "div#
     onetrust-policy-text is tabindex=0 but non-interactive; Shift+Tab
     does not move focus and Enter/Space have no effect — per-component
     trap per SC 2.1.2").
  6. suggestedFix: concrete developer action targeting the offending
     element (e.g. "Remove tabindex=0 from div#onetrust-policy-text, or
     ensure Shift+Tab moves focus to the previous focusable element").
     For passes, this can be an enhancement note or empty.

Constraints:
- Do NOT navigate away or reload.
- Do NOT invent findings you have not verified with a tool call.
- Test the FULL ring before deciding pass. A single working button does
  NOT cure a dead-end on a different ring member.
- For repeated Shift+Tab tests, do at most 2 consecutive Shift+Tab
  presses on the same element — some pages crash on long Shift+Tab
  loops. Two presses with no focus change is sufficient evidence of a
  dead-end.
- If activation dismisses the banner, the page state changes — that is fine
  and expected; record it. Do this LAST so you can still test other ring
  members first.

Respond ONLY by calling tools. The investigation ends when you call \`finalize\`.`;

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
    confidence: 'low',
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
  const confidence =
    (input['confidence'] as SC212EscalationResult['confidence']) ?? 'medium';

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
    confidence,
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