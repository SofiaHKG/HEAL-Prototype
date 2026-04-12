import type { EvidenceBundle } from '../types/finding';
import type { Assessment } from '../llm/parser';

export interface SC212Result {
  bundle: EvidenceBundle;
  assessment: Assessment;
}