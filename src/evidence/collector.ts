import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { EvidenceBundle } from '../types/finding';

export interface EvidenceCollector {
  readonly sc: string;
  collect(client: Client): Promise<EvidenceBundle[]>;
}