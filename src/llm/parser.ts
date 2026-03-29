export type Verdict = 'pass' | 'fail' | 'needs_review';
export type Uncertainty = 'low' | 'medium' | 'high';

export interface Assessment {
  verdict: Verdict;
  rationale: string;
  uncertainty: Uncertainty;
}

const VALID_VERDICTS = new Set<string>(['pass', 'fail', 'needs_review']);
const VALID_UNCERTAINTIES = new Set<string>(['low', 'medium', 'high']);

export function parseAssessment(raw: string): Assessment {
  // parse and validate a raw Claude reply into as assessment object, throwing if invalid format or values
}