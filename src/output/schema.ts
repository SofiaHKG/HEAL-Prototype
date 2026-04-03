export interface HealFinding {
  sc: string;
  selector: string;
  outerHTML: string;
  evidence: Record<string, unknown>;
  verdict: 'pass' | 'fail' | 'needs_review';
  rationale: string;
  uncertainty: 'low' | 'medium' | 'high';
}