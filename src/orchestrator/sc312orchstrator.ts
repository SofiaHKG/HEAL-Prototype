import type { EvidenceBundle } from '../types/finding';
import type { Assessment } from '../llm/parser';

// Result shape
export interface SC312Result {
  bundle: EvidenceBundle;
  assessment: Assessment;
}