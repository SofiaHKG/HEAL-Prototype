import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { evaluate, pressKey, screenshot, waitFor } from '../mcp/tools';
import type {
  CookieBannerHandling,
  EvidenceBundle,
  FocusStep,
  SC212Evidence,
} from '../types/finding';
import { parseEvalJson } from '../mcp/evalUtils';

const MAX_TABS = 50;
const TRAP_THRESHOLD = 3;
const CYCLE_RATIO_MAX = 0.1;
const CYCLE_UNIQUE_MAX = 8;
const CYCLE_MIN_TABS = 15;

// After dismissing a banner, how many Tabs to try before declaring focus lost
const POST_DISMISS_PROBE_TABS = 5;

// Substrings that could sugget a selector belongs to a cookie/consent banner
const COOKIE_SELECTOR_HINTS = [
  'cookie', 'cookiebot', 'consent', 'gdpr', 'ccpa',
  'onetrust', 'didomi', 'truste', 'usercentrics', 'klaro',
  'cmp', 'privacy', 'tracking',
];

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

// JS that scans the whole document for plausible cookie-banner dismiss buttons
function buildClassifyDismissJS(_selectors: string[]): string {
  return `() => {
    var COOKIE_HINTS = [
      'cookie','cookiebot','cookieconsent','cookie-banner','cookie-bar','cookie-notice',
      'consent','consent-banner','gdpr','ccpa','onetrust','didomi','truste',
      'usercentrics','klaro','cmp','privacy','tracking','c24-cc','cc-banner','cc-overlay'
    ];
    var DENY = /\\b(decline|deny|reject|refuse|disagree|disallow|necessary only|essential only|opt[\\s_-]?out|ablehnen|verweigern|nur notwendige|nicht akzeptieren|nur essenziell|nur erforderliche)\\b/i;
    var ACCEPT = /\\b(accept|allow|agree|approve|got it|ok|consent to all|akzeptieren|zustimmen|einverstanden|erlauben|geht klar|verstanden|alles klar|alle akzeptieren|alle zulassen|annehmen)\\b/i;
    var LEGAL_HREF = /datenschutz|privacy|impressum|cookie-?richtlinie|cookie-?policy|policy|imprint|terms|agb/i;

    function isButtonish(el) {
      var tag = el.tagName.toLowerCase();
      if (tag === 'button') return true;
      var role = (el.getAttribute('role') || '').toLowerCase();
      if (role === 'button') return true;
      if (tag === 'input') {
        var t = (el.getAttribute('type') || '').toLowerCase();
        if (t === 'button' || t === 'submit') return true;
      }
      if (tag === 'a') return true;
      return false;
    }
    function visibleText(el) {
      var t = (el.innerText || el.textContent || '').trim();
      if (!t) t = (el.getAttribute('aria-label') || '').trim();
      if (!t && el.tagName.toLowerCase() === 'input') {
        t = (el.getAttribute('value') || '').trim();
      }
      return t.replace(/\\s+/g, ' ');
    }
    function isVisible(el) {
      if (!el.isConnected) return false;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      var cur = el;
      while (cur && cur.nodeType === 1) {
        var s = window.getComputedStyle(cur);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
        cur = cur.parentElement;
      }
      return true;
    }
    function bannerAncestor(el) {
      var cur = el;
      while (cur && cur !== document.body && cur.nodeType === 1) {
        var sig = ((cur.id || '') + ' ' +
                   (typeof cur.className === 'string' ? cur.className : '')).toLowerCase();
        for (var i = 0; i < COOKIE_HINTS.length; i++) {
          if (sig.indexOf(COOKIE_HINTS[i]) !== -1) return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    }
    function escapeAttr(v) { return String(v).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"'); }
    function unique(candidate, target) {
      try {
        var ms = document.querySelectorAll(candidate);
        if (ms.length === 1 && ms[0] === target) return candidate;
      } catch (e) {}
      return null;
    }
    function selectorFor(el) {
      var tag = el.tagName.toLowerCase();
      if (el.id) {
        var u = unique(tag + '#' + CSS.escape(el.id), el);
        if (u) return u;
      }
      var aria = el.getAttribute('aria-label');
      if (aria) {
        var u2 = unique(tag + '[aria-label="' + escapeAttr(aria) + '"]', el);
        if (u2) return u2;
      }
      // Structural fallback
      var parts = []; var cur = el;
      while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
        var part = cur.tagName.toLowerCase();
        if (cur.id) { parts.unshift(part + '#' + CSS.escape(cur.id)); break; }
        var p = cur.parentElement;
        if (p) {
          var same = Array.prototype.filter.call(p.children, function(s){return s.tagName === cur.tagName;});
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur)+1) + ')';
        }
        parts.unshift(part);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }

    var all = document.querySelectorAll(
      'button, [role="button"], input[type="button"], input[type="submit"], a[href]'
    );
    var denyInBanner = null, acceptInBanner = null;
    var denyAny = null, acceptAny = null;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!isVisible(el)) continue;
      var text = visibleText(el);
      if (!text || text.length > 80) continue;
      var matchDeny = DENY.test(text);
      var matchAccept = ACCEPT.test(text);
      if (!matchDeny && !matchAccept) continue;
      // Reject anchors that point to legal/policy pages
      if (el.tagName.toLowerCase() === 'a') {
        var href = el.getAttribute('href') || '';
        if (href && href !== '#' && !/^javascript:/i.test(href) && LEGAL_HREF.test(href)) continue;
      }
      var inBanner = bannerAncestor(el) !== null;
      var sel = selectorFor(el);
      if (inBanner) {
        if (matchDeny && !denyInBanner) denyInBanner = sel;
        if (matchAccept && !acceptInBanner) acceptInBanner = sel;
      } else {
        if (matchDeny && !denyAny) denyAny = sel;
        if (matchAccept && !acceptAny) acceptAny = sel;
      }
    }
    return {
      deny: denyInBanner || denyAny,
      accept: acceptInBanner || acceptAny,
    };
  }`;
}

// JS that focuses an element (so a subsequent Enter press activates it as a click)
function buildFocusSelectorJS(selector: string): string {
  return `() => {
    try {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (el && typeof el.focus === 'function') { el.focus(); return true; }
    } catch (e) {}
    return false;
  }`;
}

// JS that returns whether the given selector still resolves to a visible element
function buildBannerStillVisibleJS(selector: string): string {
  return `() => {
    try {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      if (!el.isConnected) return false;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      var cur = el;
      while (cur && cur.nodeType === 1) {
        var s = window.getComputedStyle(cur);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) {
          return false;
        }
        cur = cur.parentElement;
      }
      return true;
    } catch (e) { return false; }
  }`;
}

// JS that programmatically clicks the element
// Used as a fallback when the keyboard Enter event didn't dismiss the banner
function buildClickSelectorJS(selector: string): string {
  return `() => {
    try {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (el && typeof el.click === 'function') { el.click(); return true; }
    } catch (e) {}
    return false;
  }`;
}

// Do any of the selectors look like part of a cookie/consent banner?...
function looksLikeCookieBanner(selectors: readonly string[]): boolean {
  return selectors.some(sel => {
    const lower = sel.toLowerCase();
    return COOKIE_SELECTOR_HINTS.some(hint => lower.includes(hint));
  });
}

function buildBannerCandidateSelectors(traversal: TraversalResult): string[] {
  const fromTraversal = Array.from(traversal.uniqueSelectors);
  const commonGuesses = [
    '[id*="cookie" i] button',
    '[class*="cookie" i] button',
    '[id*="consent" i] button',
    '[class*="consent" i] button',
    '[aria-label*="cookie" i]',
    '[aria-label*="consent" i]',
    '[aria-label*="ablehnen" i]',
    '[aria-label*="akzeptieren" i]',
  ];
  return [...fromTraversal, ...commonGuesses];
}

interface TraversalResult {
  focusSequence: FocusStep[];
  uniqueSelectors: Set<string>;
  trapDetected: boolean;
  trapType: SC212Evidence['trapType'];
  stuckSelector: string | null;
  cycleSelectors: string[] | null;
  anyFocusGained: boolean;
}

// Press Tab up to maxTabs times, for recording the focus sequence and detecting traps
async function tabTraversal(
  client: Client,
  totalPageFocusable: number,
  maxTabs: number,
): Promise<TraversalResult> {
  const focusSequence: FocusStep[] = [];
  const uniqueSelectors = new Set<string>();
  let trapDetected = false;
  let trapType: TraversalResult['trapType'] = null;
  let stuckSelector: string | null = null;
  let cycleSelectors: string[] | null = null;
  let consecutiveCount = 0;
  let lastSelector = '';
  let anyFocusGained = false;

  for (let i = 0; i < maxTabs; i++) {
    await pressKey(client, 'Tab');

    const raw = await evaluate(client, GET_ACTIVE_ELEMENT_SC212_JS);
    const info = parseEvalJson<ActiveElementInfo | null>(raw);

    if (info === null) {
      // Focus on body/root: either natural end of tab order or focus never landed
      continue;
    }

    anyFocusGained = true;

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
        trapType = 'consecutive';
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
      totalPageFocusable > 0 &&
      uniqueSelectors.size / totalPageFocusable <= CYCLE_RATIO_MAX
    ) {
      trapDetected = true;
      trapType = 'cycle';
      // The "stuck" element in a cycle trap is the most recently seen one
      stuckSelector = info.selector;
      cycleSelectors = Array.from(uniqueSelectors);
      break;
    }
  }

  return {
    focusSequence,
    uniqueSelectors,
    trapDetected,
    trapType,
    stuckSelector,
    cycleSelectors,
    anyFocusGained,
  };
}

// FOr debugging: capture a full-page screenshot and save under reports/debug/
async function saveDebugScreenshot(client: Client, label: string): Promise<string | null> {
  try {
    const img = await screenshot(client, { fullPage: true });
    if (!img) return null;
    const dir = path.resolve('reports', 'debug');
    await fs.promises.mkdir(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = 'sc212-' + label + '-' + ts + '.png';
    const fullPath = path.join(dir, filename);
    await fs.promises.writeFile(fullPath, Buffer.from(img.data, 'base64'));
    return path.relative(process.cwd(), fullPath).replace(/\\/g, '/');
  } catch {
    return null;
  }
}

// Try to dismiss a cookie banner via the keyboard
// Prefer the deny/decline button Sover accept/allow
async function attemptCookieBannerDismissal(
  client: Client,
  candidateSelectors: string[],
): Promise<{
  attempted: boolean;
  selector: string | null;
  role: 'deny' | 'accept' | null;
  succeeded: boolean | null;
  beforeScreenshotPath: string | null;
  afterScreenshotPath: string | null;
}> {
  const classifyRaw = await evaluate(client, buildClassifyDismissJS(candidateSelectors));
  const classified = parseEvalJson<{ deny: string | null; accept: string | null } | null>(classifyRaw);

  const denySel = classified?.deny ?? null;
  const acceptSel = classified?.accept ?? null;

  const chosen: { selector: string; role: 'deny' | 'accept' } | null =
    denySel ? { selector: denySel, role: 'deny' }
    : acceptSel ? { selector: acceptSel, role: 'accept' }
    : null;

  if (!chosen) {
    return {
      attempted: false, selector: null, role: null, succeeded: null,
      beforeScreenshotPath: null, afterScreenshotPath: null,
    };
  }

  // Snapshot the page state BEFORE attempting dismissal
  const beforeScreenshotPath = await saveDebugScreenshot(client, 'before-dismiss');

  // Focus the dismiss control, then activate it via the keyboard (Enter)
  const focusedRaw = await evaluate(client, buildFocusSelectorJS(chosen.selector));
  const focused = parseEvalJson<boolean>(focusedRaw);
  if (!focused) {
    const afterScreenshotPath = await saveDebugScreenshot(client, 'after-dismiss-focus-failed');
    return {
      attempted: true, selector: chosen.selector, role: chosen.role, succeeded: false,
      beforeScreenshotPath, afterScreenshotPath,
    };
  }

  await pressKey(client, 'Enter');

  // Give the page time to dismiss the banner
  try { await waitFor(client, { time: 2 }); } catch { /* best effort */ }

  let stillVisibleRaw = await evaluate(client, buildBannerStillVisibleJS(chosen.selector));
  let stillVisible = parseEvalJson<boolean>(stillVisibleRaw);

  // Fallback: if Enter didn't take effect, invoke the button programmatically
  if (stillVisible) {
    await evaluate(client, buildClickSelectorJS(chosen.selector));
    try { await waitFor(client, { time: 2 }); } catch { /* best effort */ }
    stillVisibleRaw = await evaluate(client, buildBannerStillVisibleJS(chosen.selector));
    stillVisible = parseEvalJson<boolean>(stillVisibleRaw);
  }

  // Debugging: Snapshot the page state AFTER attempting dismissal
  const afterScreenshotPath = await saveDebugScreenshot(client, 'after-dismiss');

  return {
    attempted: true,
    selector: chosen.selector,
    role: chosen.role,
    succeeded: !stillVisible,
    beforeScreenshotPath,
    afterScreenshotPath,
  };
}

export async function collectSC212Evidence(client: Client): Promise<EvidenceBundle[]> {
  // Count total focusable elements
  const countRaw = await evaluate(client, GET_FOCUSABLE_COUNT_SC212_JS);
  const totalPageFocusable = parseEvalJson<number>(countRaw);

  // Initial traversal: focus first focusable and then tab
  await evaluate(client, FOCUS_FIRST_FOCUSABLE_SC212_JS);
  let traversal = await tabTraversal(client, totalPageFocusable, MAX_TABS);

  const cookieBanner: CookieBannerHandling = {
    detected: false,
    dismissalAttempted: false,
    dismissalSelector: null,
    dismissalRole: null,
    dismissalSucceeded: null,
    postDismissalFocusGained: null,
    beforeScreenshotPath: null,
    afterScreenshotPath: null,
  };
  let postDismissalFocusSequence: FocusStep[] | null = null;

  // Snapshot the original cycle for the post-dismissal "did focus actually escape?" check
  const originalCycle = new Set<string>(
    traversal.cycleSelectors ?? Array.from(traversal.uniqueSelectors),
  );

  const candidateSelectors = buildBannerCandidateSelectors(traversal);
  const dismissal = await attemptCookieBannerDismissal(client, candidateSelectors);

  if (dismissal.attempted) {
    cookieBanner.detected = true;
    cookieBanner.dismissalAttempted = true;
    cookieBanner.dismissalSelector = dismissal.selector;
    cookieBanner.dismissalRole = dismissal.role;
    cookieBanner.dismissalSucceeded = dismissal.succeeded;
    cookieBanner.beforeScreenshotPath = dismissal.beforeScreenshotPath;
    cookieBanner.afterScreenshotPath = dismissal.afterScreenshotPath;
  } else if (
    traversal.trapType === 'cycle' &&
    traversal.cycleSelectors !== null &&
    looksLikeCookieBanner(traversal.cycleSelectors)
  ) {
    // Saw a banner-shaped cycle but couldn't classify any deny/accept button
    cookieBanner.detected = true;
  }

  if (dismissal.attempted && dismissal.succeeded) {
      const probe = await tabTraversal(client, totalPageFocusable, POST_DISMISS_PROBE_TABS);
      cookieBanner.postDismissalFocusGained = probe.anyFocusGained;
      postDismissalFocusSequence = probe.focusSequence;
      const escapedCycle = probe.focusSequence.some(s => !originalCycle.has(s.selector));

      if (probe.anyFocusGained && escapedCycle) {
        // Real navigation works: continuing with a full traversal so the rest
        // of the page is properly assessed for traps further down the tree
        const full = await tabTraversal(
          client,
          totalPageFocusable,
          MAX_TABS - probe.focusSequence.length,
        );
        // Re-number the appended steps for the combined sequence
        const offset = probe.focusSequence.length;
        const renumbered = full.focusSequence.map(s => ({ ...s, tabIndex: s.tabIndex + offset }));
        postDismissalFocusSequence = [...probe.focusSequence, ...renumbered];

        // Replace initial banner-cycle traversal with the post-dismissal for final verdict
        // (the banner cycle is no longer a trap)
        traversal = {
          focusSequence: postDismissalFocusSequence,
          uniqueSelectors: new Set(postDismissalFocusSequence.map(s => s.selector)),
          trapDetected: full.trapDetected,
          trapType: full.trapType,
          stuckSelector: full.stuckSelector,
          cycleSelectors: full.cycleSelectors,
          anyFocusGained: true,
        };
      } else {
        // Banner reports as closed but keyboard focus is still trapped
        // because either it lands nowhere (focus stranded) 
        // or it keeps cycling through the same banner controls (residual hidden overlay)
        traversal = {
          ...traversal,
          trapDetected: true,
          trapType: 'focus_lost_after_dismiss',
          stuckSelector: null,
          cycleSelectors: null,
        };
      }
    }

  const movedOut = (newSelector: string | null): boolean => {
    if (newSelector === null) return false; // body/null is NOT a real escape
    if (traversal.trapType === 'cycle' && traversal.cycleSelectors !== null) {
      return !traversal.cycleSelectors.includes(newSelector);
    }
    return newSelector !== traversal.stuckSelector;
  };

  // Verify a candidate "escape" really frees the user...
  const ESCAPE_PROBE_TABS = 4;
  const escapeReallyFrees = async (): Promise<{ freed: boolean; sequence: FocusStep[] }> => {
    const sequence: FocusStep[] = [];
    let landedOutside = false;
    let returnedToTrap = false;
    for (let i = 0; i < ESCAPE_PROBE_TABS; i++) {
      await pressKey(client, 'Tab');
      const raw = await evaluate(client, GET_ACTIVE_ELEMENT_SC212_JS);
      const info = parseEvalJson<ActiveElementInfo | null>(raw);
      const sel = info?.selector ?? null;
      if (info !== null) {
        sequence.push({
          tabIndex: i + 1,
          selector: info.selector,
          tagName: info.tagName,
          id: info.id,
        });
      }
      if (movedOut(sel)) {
        landedOutside = true;
      } else if (sel !== null) {
        // Focus is back on the trap (or another element inside the trap cycle)
        returnedToTrap = true;
      }
      // body/null on a single Tab is inconclusive -> keep probing
    }
    return { freed: landedOutside && !returnedToTrap, sequence };
  };

  let escapeBehavior: SC212Evidence['escapeBehavior'] = 'not_tested';
  let shiftTabBehavior: SC212Evidence['shiftTabBehavior'] = 'not_tested';
  let escapeProbeSequence: FocusStep[] | null = null;
  let shiftTabProbeSequence: FocusStep[] | null = null;
  let escapeScreenshotPath: string | null = null;

  // Only meaningful for traps where there's a concrete stuck element to escape from
  if (
    traversal.trapDetected &&
    traversal.stuckSelector !== null &&
    traversal.trapType !== 'focus_lost_after_dismiss'
  ) {
    await pressKey(client, 'Escape');
    // Snapshot the page right after Escape
    escapeScreenshotPath = await saveDebugScreenshot(client, 'after-escape');
    const escapeProbe = await escapeReallyFrees();
    escapeProbeSequence = escapeProbe.sequence;
    escapeBehavior = escapeProbe.freed ? 'moved' : 'stuck';

    if (escapeBehavior === 'stuck') {
      // Re-establish focus on the trapped element so Shift+Tab is tested from
      // the same starting point as a real user would experience
      await evaluate(client, buildFocusSelectorJS(traversal.stuckSelector));
      await pressKey(client, 'Shift+Tab');
      const shiftProbe = await escapeReallyFrees();
      shiftTabProbeSequence = shiftProbe.sequence;
      shiftTabBehavior = shiftProbe.freed ? 'moved' : 'stuck';
    }
  }

  const evidence: SC212Evidence = {
    focusSequence: traversal.focusSequence,
    trapDetected: traversal.trapDetected,
    trapType: traversal.trapType,
    stuckSelector: traversal.stuckSelector,
    cycleSelectors: traversal.cycleSelectors,
    escapeBehavior,
    shiftTabBehavior,
    totalTabsPressed: traversal.focusSequence.length,
    uniqueSelectorsCount: traversal.uniqueSelectors.size,
    totalPageFocusable,
    cookieBanner,
    postDismissalFocusSequence,
    escapeProbeSequence,
    shiftTabProbeSequence,
    escapeScreenshotPath,
  };

  const elementSelector = traversal.stuckSelector ?? 'body';

  return [
    {
      sc: '2.1.2',
      element: {
        selector: elementSelector,
        outerHTML: '',
      },
      evidence: evidence as unknown as Record<string, unknown>,
    },
  ];
}