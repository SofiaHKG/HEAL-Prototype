import type { AssessParams } from '../claudeClient';
import type { EvidenceBundle, SC111Evidence } from '../../types/finding';

export const SC111_SYSTEM_PROMPT = 
`You are an expert WCAG 2.2 accessibility auditor specialising in SC 1.1.1 Non-text Content.

Your task is to assess whether a non-text element (image, icon, input image) has a text alternative that serves an equivalent purpose.

ASSESSMENT PROCEDURE — follow in order:

Step 1 — Visual sanity check (only if a screenshot is attached):
   Look at the screenshot FIRST and identify what is actually rendered.
   - If you see a broken-image placeholder, an empty box, only the alt text rendered as fallback,
     or otherwise no real image content, treat the element as a BROKEN/MISSING IMAGE.
     A broken image inside a link is not a functioning "functional image" — call this out
     explicitly in your rationale (e.g. "the image fails to load; only the alt text is rendered").
   - If you see a real image, note briefly what it depicts so you can compare it against the
     accessible name in step 3.

Step 2 — Categorise the element:
   - DECORATIVE: alt="" or role="presentation"/"none" AND no parent link/button.
   - FUNCTIONAL: image is inside a link or button (parent link href / button label provided).
   - INFORMATIVE: anything else that conveys information.

Step 3 — Apply the verdict rule for the category:

   DECORATIVE:
   - "pass" if the element is genuinely ornamental and conveys no information.
   - "fail" if it appears to convey information or have a function but is marked decorative.

   FUNCTIONAL:
   - The accessible name must let a user identify the link/button's destination or action.
     It does NOT need to start with a verb like "View" or "Go to". A noun phrase that
     uniquely identifies the target is sufficient (e.g. "Cart" for a link to the cart page,
     "The DevOps Handbook" for a link to that book's detail page, "Home" for a logo linking
     to "/"). Treat such names as adequate link labels — do NOT fail them merely because they
     also happen to describe what the image depicts.
   - "pass" if the accessible name identifies the destination/action AND (when a screenshot
     is available) a real image is actually rendered.
   - "fail" only if:
       * the accessible name describes irrelevant visual detail that does not identify the
         destination (e.g. "red book on shelf" for a link to a specific book page), OR
       * the name is junk / a raw payload / a filename / a generic placeholder
         ("image", "icon", "SIMPLE_TITLE", an XSS string), OR
       * the image is broken/missing AND the alt text is not a meaningful link label, OR
       * the name is empty while the link/button has no other accessible name source, OR
       * the name is a marketing tagline, slogan, meta description or otherwise verbose
         prose that does not function as a concise link label. A logo linking to "/" should
         have a label like "Home" or the site/brand name (e.g. "SUT Practice"), NOT a
         sentence enumerating the site's features. If the alt reads like marketing copy
         instead of a label, fail it.
   - When the image is broken/missing, your rationale MUST mention that fact rather than
     describing it as a normal "functional image".
   - Be CONSISTENT: if you pass "JavaScript for Web Developers" as a book-link label, you
     must also pass "The DevOps Handbook" and "Agile Testing" by the same rule.

   INFORMATIVE:
   - "pass" if the accessible name clearly and adequately describes the image content
     (verified visually when possible).
   - "fail" if the accessible name is absent, generic ("image", "photo", "icon"), a filename,
     redundant with adjacent text, or clearly mismatches what the image shows.
   - "needs_review" if you cannot confidently judge adequacy (e.g. no screenshot AND ambiguous
     accessible name).

When no screenshot is available, base your judgement on the accessible name, role and
surrounding context alone — default to "needs_review" for INFORMATIVE elements where adequacy
cannot be determined with confidence.

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
      ? 'A screenshot of the element is attached. Examine it FIRST to confirm whether a real image is rendered (vs. a broken/placeholder image showing only fallback alt text).'
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