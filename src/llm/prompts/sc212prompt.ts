import type { EvidenceBundle, SC212Evidence } from '../../types/finding';

// System prompt
export const SC212_SYSTEM_PROMPT =
`You are an expert WCAG 2.2 accessibility auditor specialising in SC 2.1.2 No Keyboard Trap.

Your task is to assess whether a page contains a keyboard trap: a UI component that captures keyboard focus and does not allow the user to move focus away using standard keyboard mechanisms (Tab, Shift+Tab, Escape, or arrow keys).

You will receive evidence from an automated keyboard traversal of the page, including:
- The focus sequence (selectors visited during Tab traversal)
- Whether a potential trap was detected algorithmically
- Which element appears to trap focus (if any)
- Whether Escape or Shift+Tab successfully moved focus away from the stuck element

Verdict rules:
- "pass": No trap was detected, OR a trap was detected but Escape or Shift+Tab successfully moved focus away (an alternate mechanism exists).
- "fail": A trap was detected AND neither Escape nor Shift+Tab freed the user (no standard escape mechanism works).
- "needs_review": Evidence is inconclusive (e.g. the page has very few focusable elements, the traversal was too short to tell, or the stuck element may be a legitimate modal with an undiscovered dismiss mechanism).

Consider:
- trapDetected flag and stuckSelector
- escapeBehavior and shiftTabBehavior results
- Ratio of uniqueSelectorsCount to totalPageFocusable (a very small ratio after many tabs suggests cycling)
- totalTabsPressed vs totalPageFocusable (did traversal cover enough of the page?)

Respond with ONLY a JSON object in this exact shape - no prose, no markdown fences:
{"verdict":"pass"|"fail"|"needs_review","rationale":"<one or two sentences>","uncertainty":"low"|"medium"|"high"}`;


// Build the user message from one SC 2.1.2 evidence bundle
export function buildSC212UserMessage(bundle: EvidenceBundle): string {
  const ev = bundle.evidence as unknown as SC212Evidence;

  // Summarise the focus sequence (first and last 5 steps to stay concise)
  let sequenceSummary: string;
  if (ev.focusSequence.length <= 10) {
    sequenceSummary = ev.focusSequence
      .map(s => `  ${s.tabIndex}. ${s.selector}`)
      .join('\n');
  } else {
    const head = ev.focusSequence.slice(0, 5);
    const tail = ev.focusSequence.slice(-5);
    sequenceSummary =
      head.map(s => `  ${s.tabIndex}. ${s.selector}`).join('\n') +
      '\n  ... (' + (ev.focusSequence.length - 10) + ' steps omitted) ...\n' +
      tail.map(s => `  ${s.tabIndex}. ${s.selector}`).join('\n');
  }

  return (
    'Stuck element selector: ' + (ev.stuckSelector ?? '(none)') + '\n' +
    'Trap detected: ' + String(ev.trapDetected) + '\n' +
    'Escape behaviour: ' + ev.escapeBehavior + '\n' +
    'Shift+Tab behaviour: ' + ev.shiftTabBehavior + '\n' +
    'Total Tab presses: ' + ev.totalTabsPressed + '\n' +
    'Unique selectors visited: ' + ev.uniqueSelectorsCount + '\n' +
    'Total focusable elements on page: ' + ev.totalPageFocusable + '\n' +
    '\nFocus sequence:\n' + sequenceSummary + '\n' +
    '\nAssess whether this page has a keyboard trap per SC 2.1.2 and return your JSON verdict.'
  );
}