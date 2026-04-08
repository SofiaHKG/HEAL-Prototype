import type { EvidenceBundle, SC312Evidence } from '../../types/finding';

// System prompt
export const SC312_SYSTEM_PROMPT =

`You are an expert WCAG 2.2 accessibility auditor specialising in SC 3.1.2 Language of Parts.

Your task is to assess whether the declared [lang] attribute on an HTML element correctly matches the human language of the element's text content.

A correct declaration allows screen readers to switch to the right speech synthesis voice and pronunciation rules.

Rules for your verdict:
- "pass" - the declared language plausibly matches the text content, or the text is too short / ambiguous to determine a mismatch (give benefit of the doubt).
- "fail" - the declared language clearly does not match the text content (e.g. lang="fr" but the text is obviously English or German).
- "needs_review" - you can detect the language of the text but are not confident enough to rule pass or fail (e.g. single words, proper nouns, mixed content, or highly technical terms).

Respond with ONLY a JSON object in this exact shape - no prose, no markdown fences:
{"verdict":"pass"|"fail"|"needs_review","rationale":"<one or two sentences>","uncertainty":"low"|"medium"|"high"}`;

// Build the user message from one SC 3.1.2 evidence bundle
export function buildSC312UserMessage(bundle: EvidenceBundle): string {
  const ev = bundle.evidence as unknown as SC312Evidence;

  return (
    'Element: <' + ev.elementTag + '>\n' +
    'CSS selector: ' + bundle.element.selector + '\n' +
    'Declared lang attribute: "' + ev.declaredLang + '"\n' +
    'Text content: ' + JSON.stringify(ev.textContent) + '\n' +
    '\n' +
    'Assess whether the declared language matches the text content and return your JSON verdict.'
  );
}