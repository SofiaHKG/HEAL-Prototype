import type { EvidenceBundle, SC312Evidence } from '../../types/finding';

// System prompt
export const SC312_SYSTEM_PROMPT =
`You are an expert WCAG 2.2 accessibility auditor specialising in SC 3.1.2 Language of Parts.

SC 3.1.2 has two failure modes you may be asked to assess:

MODE A — "declared": an element has a [lang] attribute. Check whether the
declared language matches the actual language of its text content.
  - "pass" - declared language plausibly matches the text, OR text is too
    short / ambiguous to rule out (give benefit of the doubt).
  - "fail" - declared language clearly does NOT match (e.g. lang="fr" but
    text is obviously English or German).
  - "needs_review" - you can detect a language but cannot confidently rule
    pass or fail (single words, proper nouns, mixed content, technical
    jargon).

MODE B — "undeclared": a text block has NO [lang] ancestor. The page
primary language is given as pageLang. Check whether the text appears to
be in a DIFFERENT language than pageLang. If so, SC 3.1.2 requires a
[lang] annotation and the absence is a failure.
  - "pass" - the text is in the same language as pageLang (no annotation
    needed), OR the text is too short / language-neutral (numbers, brand
    names, code, proper nouns only) to require annotation.
  - "fail" - the text is clearly in a different human language than
    pageLang and contains substantive content (full phrases or sentences),
    so SC 3.1.2 requires a [lang] attribute that is missing.
  - "needs_review" - the text contains mixed languages, isolated foreign
    loanwords (e.g. "Smartphone", "Online"), brand slogans, or quotations
    where it is unclear whether annotation is required.

Important nuances for MODE B:
  - Common loanwords adopted into the page's primary language do NOT
    require annotation (e.g. "Smartphone", "Marketing", "Newsletter" on a
    German page → pass).
  - Proper nouns and brand names do NOT require annotation.
  - A genuine phrase or sentence in a foreign language DOES require it
    (e.g. an English tagline "Connecting people" on a German page → fail).

Respond with ONLY a JSON object in this exact shape - no prose, no markdown fences:
{"verdict":"pass"|"fail"|"needs_review","rationale":"<one or two sentences>","uncertainty":"low"|"medium"|"high"}`;

// Build the user message from one SC 3.1.2 evidence bundle
export function buildSC312UserMessage(bundle: EvidenceBundle): string {
  const ev = bundle.evidence as unknown as SC312Evidence;

  const header =
    'Mode: ' + ev.mode + '\n' +
    'Page primary language (<html lang>): "' + (ev.pageLang || '(none)') + '"\n' +
    'Element: <' + ev.elementTag + '>\n' +
    'CSS selector: ' + bundle.element.selector + '\n';

  if (ev.mode === 'declared') {
    return (
      header +
      'Declared lang attribute on this element: "' + ev.declaredLang + '"\n' +
      'Text content: ' + JSON.stringify(ev.textContent) + '\n' +
      '\n' +
      'MODE A task: assess whether the declared language matches the text ' +
      'content and return your JSON verdict.'
    );
  }

  return (
    header +
    'This element has NO [lang] attribute and no [lang] ancestor (other than <html>).\n' +
    'Text content: ' + JSON.stringify(ev.textContent) + '\n' +
    '\n' +
    'MODE B task: determine whether this text is in a DIFFERENT language ' +
    'than the page primary language ("' + (ev.pageLang || 'unknown') + '"). ' +
    'If yes and the text is substantive (not just loanwords / proper nouns), ' +
    'verdict = fail (missing [lang] required by SC 3.1.2). Otherwise pass ' +
    'or needs_review per the rules.'
  );
}