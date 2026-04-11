import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { evaluate } from '../mcp/tools';
import type { EvidenceBundle } from '../types/finding';
import { parseEvalJson } from '../mcp/evalUtils';

const FOCUS_FIRST_FOCUSABLE_SC212_JS = `() => {
  var selector = [
    'a[href]','button:not([disabled])',
    'input:not([type=hidden]):not([disabled])',
    'select:not([disabled])','textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  var el = document.querySelector(selector);

  if (el && typeof el.focus === 'function') {
    el.focus();
  }

  return !!el;
}`;

const GET_FOCUSABLE_COUNT_SC212_JS = `() => {
  var selector = [
    'a[href]','button:not([disabled])',
    'input:not([type=hidden]):not([disabled])',
    'select:not([disabled])','textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  return document.querySelectorAll(selector).length;
}`;

export async function collectSC212Evidence(client: Client): Promise<EvidenceBundle[]> {
  const countRaw = await evaluate(client, GET_FOCUSABLE_COUNT_SC212_JS);
  const totalPageFocusable = parseEvalJson<number>(countRaw);

  await evaluate(client, FOCUS_FIRST_FOCUSABLE_SC212_JS);

  // TODO: Tab traversal loop

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
        totalPageFocusable,
      } as unknown as Record<string, unknown>,
    },
  ];
}