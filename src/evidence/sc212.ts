import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { EvidenceBundle } from '../types/finding';

export async function collectSC212Evidence(client: Client): Promise<EvidenceBundle[]> {
  return [
    {
      sc: '2.1.2',
      element: { selector: 'body', outerHTML: '' },
      evidence: {
        focusSequence: [],
        trapDetected: false,
        stuckSelector: null,
        escapeBehavior: 'not_tested',
        shiftTabBehavior: 'not_tested',
        totalTabsPressed: 0,
        uniqueSelectorsCount: 0,
        totalPageFocusable: 0,
      },
    },
  ];
}