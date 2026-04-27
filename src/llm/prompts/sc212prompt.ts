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
- Whether a cookie/consent banner was detected and dismissed via the keyboard, and what happened next

Cookie banner handling:
- A cookie/consent banner that initially captures focus is NOT a keyboard trap as long as the user can dismiss it from the keyboard (e.g. by pressing Enter on a Decline/Accept button). The dismissal was attempted automatically; check 'cookieBanner.dismissalSucceeded' and 'cookieBanner.postDismissalFocusGained'.
- If the banner was dismissed AND Tab subsequently moved focus to elements OUTSIDE the original banner cycle → the banner is NOT a trap; judge the post-dismissal traversal.
- If the banner reports as dismissed BUT pressing Tab afterwards either lands nowhere OR keeps cycling through the same banner buttons (trapType = "focus_lost_after_dismiss"), this IS a real SC 2.1.2 violation — keyboard users cannot reach any other page content.

Verdict rules:
- "pass": No trap was detected, OR a trap was detected but Escape or Shift+Tab successfully moved focus away, OR the only "trap" was a cookie banner that closed cleanly and keyboard navigation works afterwards.
- "fail": A trap was detected AND no standard escape mechanism works. This includes the "focus_lost_after_dismiss" case (focus is stranded after closing a banner).
- "needs_review": Evidence is inconclusive (very few focusable elements, traversal too short, banner dismissal could not be attempted, etc.).

Consider:
- trapDetected, trapType, and stuckSelector
- escapeBehavior and shiftTabBehavior results
- cookieBanner.detected / dismissalAttempted / dismissalSucceeded / postDismissalFocusGained
- Ratio of uniqueSelectorsCount to totalPageFocusable (a very small ratio after many tabs suggests cycling)
- totalTabsPressed vs totalPageFocusable (did traversal cover enough of the page?)

Respond with ONLY a JSON object in this exact shape - no prose, no markdown fences:
{"verdict":"pass"|"fail"|"needs_review","rationale":"<one or two sentences>","confidence":"low"|"medium"|"high"}`;


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

  const cb = ev.cookieBanner;
  const cookieBannerSummary =
    'Cookie banner detected: ' + String(cb.detected) + '\n' +
    '  dismissal attempted: ' + String(cb.dismissalAttempted) + '\n' +
    '  dismissal selector: ' + (cb.dismissalSelector ?? '(none)') + '\n' +
    '  dismissal role: ' + (cb.dismissalRole ?? '(none)') + '\n' +
    '  dismissal succeeded: ' + (cb.dismissalSucceeded === null ? 'n/a' : String(cb.dismissalSucceeded)) + '\n' +
    '  post-dismissal focus gained: ' + (cb.postDismissalFocusGained === null ? 'n/a' : String(cb.postDismissalFocusGained));

  return (
    'Stuck element selector: ' + (ev.stuckSelector ?? '(none)') + '\n' +
    'Trap detected: ' + String(ev.trapDetected) + '\n' +
    'Trap type: ' + (ev.trapType ?? '(none)') + '\n' +
    'Escape behaviour: ' + ev.escapeBehavior + '\n' +
    'Shift+Tab behaviour: ' + ev.shiftTabBehavior + '\n' +
    'Total Tab presses: ' + ev.totalTabsPressed + '\n' +
    'Unique selectors visited: ' + ev.uniqueSelectorsCount + '\n' +
    'Total focusable elements on page: ' + ev.totalPageFocusable + '\n' +
    '\n' + cookieBannerSummary + '\n' +
    '\nFocus sequence:\n' + sequenceSummary + '\n' +
    '\nAssess whether this page has a keyboard trap per SC 2.1.2 and return your JSON verdict.'
  );
}