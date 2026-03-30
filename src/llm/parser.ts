export type Verdict = 'pass' | 'fail' | 'needs_review';
export type Uncertainty = 'low' | 'medium' | 'high';

export interface Assessment {
  verdict: Verdict;
  rationale: string;
  uncertainty: Uncertainty;
}

const VALID_VERDICTS = new Set<string>(['pass', 'fail', 'needs_review']);
const VALID_UNCERTAINTIES = new Set<string>(['low', 'medium', 'high']);

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
  } catch (e) {
    throw new Error(
      'parseAssessment: reply is not valid JSON.\n' +
        'Raw (first 400 chars): ' + raw.slice(0, 400) + '\n' +
        'Error: ' + String(e)
    );
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

  // uncertainty
  if (typeof obj['uncertainty'] !== 'string' || !VALID_UNCERTAINTIES.has(obj['uncertainty'])) {
    throw new Error(
      'parseAssessment: invalid uncertainty "' + String(obj['uncertainty']) + '". ' +
        'Must be one of: low | medium | high'
    );
  }

  return {
    verdict: obj['verdict'] as Verdict,
    rationale: obj['rationale'],
    uncertainty: obj['uncertainty'] as Uncertainty,
  };
}