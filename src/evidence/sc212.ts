import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { evaluate, pressKey } from '../mcp/tools';
import type { EvidenceBundle, FocusStep } from '../types/finding';
import { parseEvalJson } from '../mcp/evalUtils';

const MAX_TABS = 50;

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

const GET_ACTIVE_ELEMENT_SC212_JS = `() => {
  function getSelector(el) {
    var tag = el.tagName.toLowerCase();

    var id = el.id ? el.id.trim() : '';
    if (id) return tag + '#' + id;

    var className =
      typeof el.className === 'string' ? el.className.trim() : '';

    var firstClass = className
      ? className.split(/\\s+/)[0]
      : null;

    if (firstClass) return tag + '.' + firstClass;

    return tag;
  }

  var el = document.activeElement;

  if (!el || el === document.body || el === document.documentElement) {
    return null;
  }

  var id = el.id ? el.id.trim() : null;
  var tag = el.tagName.toLowerCase();

  return {
    selector: getSelector(el),
    tagName: tag,
    id: id
  };
}`;

interface ActiveElementInfo {
  selector: string;
  tagName: string;
  id: string | null;
}

export async function collectSC212Evidence(client: Client): Promise<EvidenceBundle[]> {
  const countRaw = await evaluate(client, GET_FOCUSABLE_COUNT_SC212_JS);
  const totalPageFocusable = parseEvalJson<number>(countRaw);

  await evaluate(client, FOCUS_FIRST_FOCUSABLE_SC212_JS);

  const focusSequence: FocusStep[] = [];
  const uniqueSelectors = new Set<string>();

  for (let i = 0; i < MAX_TABS; i++) {
    await pressKey(client, 'Tab');
    const raw = await evaluate(client, GET_ACTIVE_ELEMENT_SC212_JS);
    const info = parseEvalJson<ActiveElementInfo | null>(raw);

    if (info === null) break; // focus fell off to body

    focusSequence.push({
      tabIndex: i + 1,
      selector: info.selector,
      tagName: info.tagName,
      id: info.id,
    });
    uniqueSelectors.add(info.selector);
  }

  return [
    {
      sc: '2.1.2',
      element: { selector: 'body', outerHTML: '' },
      evidence: {
        focusSequence,
        trapDetected: false,
        stuckSelector: null,
        escapeBehavior: 'not_tested',
        shiftTabBehavior: 'not_tested',
        totalTabsPressed: focusSequence.length,
        uniqueSelectorsCount: uniqueSelectors.size,
        totalPageFocusable,
      } as unknown as Record<string, unknown>,
    },
  ];
}