import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { evaluate, pressKey } from '../mcp/tools';
import type { EvidenceBundle, FocusStep, SC212Evidence } from '../types/finding';
import { parseEvalJson } from '../mcp/evalUtils';

const MAX_TABS = 50;
const TRAP_THRESHOLD = 3;
const CYCLE_UNIQUE_MAX = 3;
const CYCLE_MIN_TABS = 15;

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
  // Count total focusable elements
  const countRaw = await evaluate(client, GET_FOCUSABLE_COUNT_SC212_JS);
  const totalPageFocusable = parseEvalJson<number>(countRaw);

  // Focus first element
  await evaluate(client, FOCUS_FIRST_FOCUSABLE_SC212_JS);

  // Tab traversal
  const focusSequence: FocusStep[] = [];
  const uniqueSelectors = new Set<string>();
  let trapDetected = false;
  let stuckSelector: string | null = null;
  let consecutiveCount = 0;
  let lastSelector = '';

  for (let i = 0; i < MAX_TABS; i++) {
    await pressKey(client, 'Tab');

    const raw = await evaluate(client, GET_ACTIVE_ELEMENT_SC212_JS);
    const info = parseEvalJson<ActiveElementInfo | null>(raw);

    if (info === null) {
      // Focus returned to body/root (natural end of tab order)
      break;
    }

    const step: FocusStep = {
      tabIndex: i + 1,
      selector: info.selector,
      tagName: info.tagName,
      id: info.id,
    };
    focusSequence.push(step);
    uniqueSelectors.add(info.selector);

    // Consecutive trap detection
    if (info.selector === lastSelector) {
      consecutiveCount++;
      if (consecutiveCount >= TRAP_THRESHOLD) {
        trapDetected = true;
        stuckSelector = info.selector;
        break;
      }
    } else {
      consecutiveCount = 1;
      lastSelector = info.selector;
    }

    // Only check after enough Tab presses to rule out a naturally small page
    if (
      i + 1 >= CYCLE_MIN_TABS &&
      uniqueSelectors.size <= CYCLE_UNIQUE_MAX &&
      totalPageFocusable > uniqueSelectors.size
    ) {
      trapDetected = true;
      // The "stuck" element in a cycle trap is the most recently seen one
      stuckSelector = info.selector;
      break;
    }
  }

  // Escape / Shift+Tab testing
  let escapeBehavior: SC212Evidence['escapeBehavior'] = 'not_tested';
  let shiftTabBehavior: SC212Evidence['shiftTabBehavior'] = 'not_tested';

  if (trapDetected && stuckSelector !== null) {
    // Test Escape
    await pressKey(client, 'Escape');
    const afterEscapeRaw = await evaluate(client, GET_ACTIVE_ELEMENT_SC212_JS);
    const afterEscape = parseEvalJson<ActiveElementInfo | null>(afterEscapeRaw);

    if (afterEscape !== null && afterEscape.selector !== stuckSelector) {
      escapeBehavior = 'moved';
    } else {
      escapeBehavior = 'stuck';

      // Escape didn't help, test Shift+Tab
      await pressKey(client, 'Shift+Tab');
      const afterShiftRaw = await evaluate(client, GET_ACTIVE_ELEMENT_SC212_JS);
      const afterShift = parseEvalJson<ActiveElementInfo | null>(afterShiftRaw);

      shiftTabBehavior =
        afterShift !== null && afterShift.selector !== stuckSelector ? 'moved' : 'stuck';
    }
  }

  const evidence: SC212Evidence = {
    focusSequence,
    trapDetected,
    stuckSelector,
    escapeBehavior,
    shiftTabBehavior,
    totalTabsPressed: focusSequence.length,
    uniqueSelectorsCount: uniqueSelectors.size,
    totalPageFocusable,
  };

  const elementSelector = stuckSelector ?? 'body';

  return [
    {
      sc: '2.1.2',
      element: {
        selector: elementSelector,
        outerHTML: '',  // page-level finding, no single element outerHTML
      },
      evidence: evidence as unknown as Record<string, unknown>,
    },
  ];
}