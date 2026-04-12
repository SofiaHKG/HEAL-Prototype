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

    function escapeAttrLocal(v) {
      return String(v).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
    }

    function unique(candidate) {
      try {
        var matches = document.querySelectorAll(candidate);
        if (matches.length === 1 && matches[0] === el) return candidate;
      } catch (e) { /* invalid sellector */ }
      return null;
    }

    function withLandmarkAncestor(candidate) {
      var landmarks = ['header', 'footer', 'main', 'nav', 'aside',
        '[role="banner"]', '[role="contentinfo"]', '[role="main"]',
        '[role="navigation"]', '[role="complementary"]'];
      var cur = el.parentElement;
      while (cur) {
        for (var i = 0; i < landmarks.length; i++) {
          if (cur.matches && cur.matches(landmarks[i])) {
            var u = unique(landmarks[i] + ' ' + candidate);
            if (u) return u;
          }
        }
        cur = cur.parentElement;
      }
      return null;
    }

    function structuralPath(node) {
      var parts = [];
      var cur = node;
      while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
        var part = cur.tagName.toLowerCase();
        if (cur.id) {
          parts.unshift(part + '#' + CSS.escape(cur.id));
          break;
        }
        var p = cur.parentElement;
        if (p) {
          var sameTag = Array.prototype.filter.call(
            p.children,
            function (s) { return s.tagName === cur.tagName; }
          );
          if (sameTag.length > 1) {
            part += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
          }
        }
        parts.unshift(part);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    var candidates = [];

    if (el.id) candidates.push(tag + '#' + CSS.escape(el.id));

    if (tag === 'a') {
      var href = el.getAttribute('href');
      if (href) candidates.push('a[href="' + escapeAttrLocal(href) + '"]');
    }

    var name = el.getAttribute('name');
    if (name) candidates.push(tag + '[name="' + escapeAttrLocal(name) + '"]');

    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) candidates.push(tag + '[aria-label="' + escapeAttrLocal(ariaLabel) + '"]');

    var typeAttr = el.getAttribute('type');
    if (typeAttr) candidates.push(tag + '[type="' + escapeAttrLocal(typeAttr) + '"]');

    var className =
      typeof el.className === 'string' ? el.className.trim() : '';
    var firstClass = className ? className.split(/\\s+/)[0] : '';
    if (firstClass) candidates.push(tag + '.' + CSS.escape(firstClass));

    candidates.push(tag);

    for (var i = 0; i < candidates.length; i++) {
      var u = unique(candidates[i]);
      if (u) return u;
    }
    for (var j = 0; j < candidates.length; j++) {
      var u2 = withLandmarkAncestor(candidates[j]);
      if (u2) return u2;
    }
    var path = structuralPath(el);
    return unique(path) || path;
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
    //trapType,
    stuckSelector,
    //cycleSelectors,
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