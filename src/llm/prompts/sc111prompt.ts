import type { AssessParams } from '../claudeClient';
import type { EvidenceBundle, SC111Evidence } from '../../types/finding';

export const SC111_SYSTEM_PROMPT = 
`You are an expert WCAG 2.2 accessibility auditor specialising in SC 1.1.1 Non-text Content.

Your task is to assess whether a non-text element (image, icon, input image) has a text alternative that serves an equivalent purpose.

Categories and verdict rules:

1. DECORATIVE — alt="" or role="presentation" or role="none":
   - "pass" if the element is genuinely decorative (purely ornamental, conveys no information, does not have a function).
   - "fail" if the element appears to convey information or have a function but is incorrectly marked as decorative.

2. INFORMATIVE — the image conveys information:
   - "pass" if the accessible name clearly and adequately describes the content or meaning of the image in its context.
   - "fail" if the accessible name is absent, is a filename, generic (e.g. "image", "photo", "icon"), redundant with adjacent text without adding value, or clearly mismatches what the image shows.
   - "needs_review" if the accessible name is present but you cannot confidently judge adequacy (e.g. no screenshot, ambiguous context).

3. FUNCTIONAL — the image is inside a link or button:
   - "pass" if the accessible name describes the destination or action.
   - "fail" if the accessible name describes the image visually rather than its function.

When a screenshot of the element is provided, use it to judge adequacy visually.
When no screenshot is available, base your judgement on the accessible name, role and surrounding context alone — default to "needs_review" if you cannot determine adequacy with confidence.

Respond with ONLY a JSON object in this exact shape — no prose, no markdown fences:
{"verdict":"pass"|"fail"|"needs_review","rationale":"<one or two sentences>","uncertainty":"low"|"medium"|"high"}`;


// Build full AssessParams for one SC 1.1.1 evidence bundle
// including screenshot as multimodal image block if available
export function buildSC111AssessParams(bundle: EvidenceBundle): AssessParams {
  const ev = bundle.evidence as unknown as SC111Evidence;

  const accessibleName =
    ev.ariaLabelledbyText ?? ev.ariaLabel ?? ev.altText ?? null;

  const isDecorative =
    ev.altText === '' ||
    ev.role === 'presentation' ||
    ev.role === 'none';

  const isFunctional =
    ev.parentLinkHref !== null || ev.parentButtonLabel !== null;

  const userMessage =
    'Element role: ' + ev.role + '\n' +
    'Element HTML: ' + bundle.element.outerHTML + '\n' +
    'alt attribute: ' + (ev.altText !== null ? JSON.stringify(ev.altText) : '(not present)') + '\n' +
    'aria-label: ' + (ev.ariaLabel !== null ? JSON.stringify(ev.ariaLabel) : '(not present)') + '\n' +
    'aria-labelledby resolved text: ' + (ev.ariaLabelledbyText !== null ? JSON.stringify(ev.ariaLabelledbyText) : '(not present)') + '\n' +
    'Computed accessible name: ' + (accessibleName !== null ? JSON.stringify(accessibleName) : '(none)') + '\n' +
    'Marked as decorative: ' + isDecorative + '\n' +
    'Functional context (image inside link/button): ' + isFunctional + '\n' +
    'Parent link href: ' + (ev.parentLinkHref !== null ? JSON.stringify(ev.parentLinkHref) : '(none)') + '\n' +
    'Parent button accessible name: ' + (ev.parentButtonLabel !== null ? JSON.stringify(ev.parentButtonLabel) : '(none)') + '\n' +
    'Surrounding context text: ' + JSON.stringify(ev.surroundingText) + '\n' +
    (ev.screenshotBase64 !== null
      ? 'A screenshot of the element is attached.'
      : 'No screenshot available (element not visible or off-screen).') + '\n' +
    '\n' +
    'Assess whether this element meets SC 1.1.1 and return your JSON verdict.';

  const params: AssessParams = {
    systemPrompt: SC111_SYSTEM_PROMPT,
    userMessage,
  };

  if (ev.screenshotBase64 !== null && ev.screenshotMimeType !== null) {
    params.imageBase64 = ev.screenshotBase64;
    const mime = ev.screenshotMimeType;
    if (
      mime === 'image/png' ||
      mime === 'image/jpeg' ||
      mime === 'image/gif' ||
      mime === 'image/webp'
    ) {
      params.imageMimeType = mime;
    }
  }

  return params;
}