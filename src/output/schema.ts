/**
 * Output schema for HEAL assessment reports
*/

/** One assessed finding - one per element per SC */
export interface HealFinding {
  sc: string;
  selector: string;
  outerHTML: string;
  evidence: Record<string, unknown>;
  verdict: 'pass' | 'fail' | 'needs_review';
  rationale: string;
  uncertainty: 'low' | 'medium' | 'high';
  escalation?: unknown;
}

/** One axe-core rule-based finding */
export interface AxeFindingEntry {
  ruleId: string;
  sc: string;
  verdict: 'fail' | 'incomplete';
  selector: string;
  html: string;
  failureSummary: string | undefined;
  helpUrl: string;
}

/** Top-level report document */
export interface HealReport {
  schemaVersion: '1.0';
  timestamp: string;
  url: string;
  axeFindings?: AxeFindingEntry[];
  findings: HealFinding[];
  summary: {
    total: number;
    pass: number;
    fail: number;
    needs_review: number;
  };
  axeSummary?: {
    total: number;
    fail: number;
    incomplete: number;
  };
}