export type Verdict = 'pass' | 'fail' | 'needs_review';
export type Confidence = 'low' | 'medium' | 'high';

export interface Assessment {
  verdict: Verdict;
  rationale: string;
  confidence: Confidence;
}

const VALID_VERDICTS = new Set<string>(['pass', 'fail', 'needs_review']);
const VALID_CONFIDENCES = new Set<string>(['low', 'medium', 'high']);

// Parse and validate a raw Claude reply into as assessment object, throwing if invalid format or values
export function parseAssessment(raw: string): Assessment {
  // Strip optional markdown code fences: ```json ... ``` or ``` ... ```
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // Recovery: model frequently uses unescaped double quotes inside the rationale string
    // (e.g. quoting an example phrase) -> pullout with regex and rebuild a valid object 
    // (rather than failing the whole run)
    const recovered = recoverAssessment(stripped);
    if (recovered) {
      parsed = recovered;
    } else {
      throw new Error(
        'parseAssessment: reply is not valid JSON and could not be recovered.\n' +
          'Raw (first 400 chars): ' + raw.slice(0, 400),
      );
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('parseAssessment: expected a JSON object, got: ' + typeof parsed);
  }

  const obj = parsed as Record<string, unknown>;

  // verdict
  if (typeof obj['verdict'] !== 'string' || !VALID_VERDICTS.has(obj['verdict'])) {
    throw new Error(
      'parseAssessment: invalid verdict "' + String(obj['verdict']) + '". ' +
        'Must be one of: pass | fail | needs_review'
    );
  }

  // rationale
  if (typeof obj['rationale'] !== 'string' || obj['rationale'].trim() === '') {
    throw new Error('parseAssessment: "rationale" must be a non-empty string');
  }

  // confidence
  if (typeof obj['confidence'] !== 'string' || !VALID_CONFIDENCES.has(obj['confidence'])) {
    throw new Error(
      'parseAssessment: invalid confidence "' + String(obj['confidence']) + '". ' +
        'Must be one of: low | medium | high'
    );
  }

  const verdict = obj['verdict'] as Verdict;
  const rationale = obj['rationale'];
  const confidence = obj['confidence'] as Confidence;

  // Guard: if the rationale visibly contradicts the verdict, downgrade to needs_review
  const lower = rationale.toLowerCase();

  // Self-correction phrasing
  const selfCorrectsToPass =
    /should\s+be\s+['"‘’“”]?pass|verdict\s*[:=]\s*pass|this\s+should\s+be\s+pass|actually\s+pass|re-?evaluation\s*:\s*[^.]*pass/.test(
      lower,
    );
  const selfCorrectsToFail =
    /should\s+be\s+['"‘’“”]?fail|verdict\s*[:=]\s*fail|this\s+should\s+be\s+fail|actually\s+fail|re-?evaluation\s*:\s*[^.]*fail/.test(
      lower,
    );

  // Conclusion-style phrasing that contradicts the verdict
  const passConclusionPatterns: RegExp[] = [
    /no\s+(?:\[?lang\]?\s+)?(?:attribute|annotation)\s+(?:is\s+)?(?:required|needed)/g,
    /does\s+not\s+(?:require|need)\s+(?:[^.]{0,40}?)?(?:annotation|\[?lang\]?\s+attribute)/g,
    /no\s+\[?lang\]?\s+annotation\s+(?:is\s+)?required/g,
    /does\s+not\s+constitute\s+substantive\s+foreign[- ]language\s+content/g,
  ];

  const failConclusionPatterns: RegExp[] = [
    /\[?lang\]?\s+attribute\s+(?:is\s+)?required/g,
    /requires?\s+(?:a\s+)?\[?lang\]?\s+(?:attribute|annotation)/g,
    /is\s+a\s+(?:violation|failure)\s+of\s+sc\s*3\.1\.2/g,
    /violates\s+sc\s*3\.1\.2/g,
  ];

  // True iff at least one pattern matches AND the match is not preceded by
  // a negator anywhere in the same sentence/clause
  function matchesUnnegated(patterns: RegExp[], text: string): boolean {
    const negator = /\b(?:no|not|n['’]t|never|without|kein(?:e|en|er|es)?|nicht|ohne)\b/i;
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const hardStart = Math.max(0, m.index - 300);
        const slice = text.slice(hardStart, m.index);
        const boundaryMatch = slice.match(/[.!?;:][^.!?;:]*$/);
        const clauseStart = boundaryMatch
          ? hardStart + (boundaryMatch.index ?? 0) + 1
          : hardStart;
        const before = text.slice(clauseStart, m.index);
        if (!negator.test(before)) return true;
      }
    }
    return false;
  }

  const concludesPass = matchesUnnegated(passConclusionPatterns, lower);
  const concludesFail = matchesUnnegated(failConclusionPatterns, lower);

  const contradicts =
    (verdict === 'fail' && (selfCorrectsToPass || (concludesPass && !concludesFail))) ||
    (verdict === 'pass' && (selfCorrectsToFail || (concludesFail && !concludesPass)));

  if (contradicts) {
    return {
      verdict: 'needs_review',
      rationale:
        '[auto-downgraded: rationale contradicted original verdict "' +
        verdict +
        '"] ' +
        rationale,
      confidence: 'low',
    };
  }

  return {
    verdict,
    rationale,
    confidence,
  };
}

// Regex recovery for replies that are almost-JSON but contain
// unescaped double quotes inside the rationale string
function recoverAssessment(text: string):
  | { verdict: string; rationale: string; confidence: string }
  | null {
  const verdictMatch = text.match(/"verdict"\s*:\s*"(pass|fail|needs_review)"/i);
  const confidenceMatch = text.match(/"confidence"\s*:\s*"(low|medium|high)"/i);
  if (!verdictMatch || !confidenceMatch) return null;

  const rationaleMatch = text.match(
    /"rationale"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"(?:confidence|verdict)"|\}\s*$)/,
  );
  if (!rationaleMatch) return null;

  // Sanitize
  const rationaleRaw = rationaleMatch[1] ?? '';
  const rationale = rationaleRaw
    .replace(/\s+/g, ' ')
    .replace(/\\"/g, '"')
    .trim();

  if (!rationale) return null;

  return {
    verdict: (verdictMatch[1] ?? '').toLowerCase(),
    rationale,
    confidence: (confidenceMatch[1] ?? '').toLowerCase(),
  };
}