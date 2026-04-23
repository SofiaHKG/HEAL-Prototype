import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { evaluate } from '../mcp/tools';
import type { EvidenceBundle, SC312Evidence } from '../types/finding';
import { parseEvalJson } from '../mcp/evalUtils';

interface SC312Data {
  mode: 'declared' | 'undeclared';
  selector: string;
  outerHTML: string;
  declaredLang: string; // empty string for undeclared
  textContent: string;
  elementTag: string;
}

interface SC312Collected {
  pageLang: string;
  items: SC312Data[];
}

const MAX_UNDECLARED = 30;
const MIN_UNDECLARED_TEXT_LENGTH = 25;

const COLLECT_SC312_JS = `() => {
  function getSelector(el) {
    var tag = el.tagName.toLowerCase();

    var id = el.id;
    if (id) return tag + '#' + id;

    var className = typeof el.className === 'string' ? el.className.trim() : '';
    var firstClass = className ? className.split(/\\s+/)[0] : null;

    if (firstClass) return tag + '.' + firstClass;

    return tag;
  }

  function scoreCandidate(tag, text) {
    var score = Math.min(text.length, 400);

    if (/[.!?]/.test(text)) score += 40;
    if (text.length >= 120) score += 40;

    if (tag === 'p' || tag === 'div' || tag === 'blockquote' || tag === 'dd') score += 80;
    if (tag === 'li') score -= 120;

    return score;
  }

  function visibleText(el) {
    if (!el) return '';
    var clone = el.cloneNode(true);
    var junk = clone.querySelectorAll(
      'style, script, template, noscript, [aria-hidden="true"], [hidden]'
    );
    for (var j = 0; j < junk.length; j++) {
      var n = junk[j];
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    return (clone.textContent || '').replace(/\\s+/g, ' ').trim();
  }

  function looksLikeCode(text) {
    if (!text) return false;
    var sample = text.slice(0, 500);
    var codeMarkers = (sample.match(/[{};:]/g) || []).length;
    var letters = (sample.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
    if (sample.length >= 80 && codeMarkers / sample.length > 0.08 && letters / sample.length < 0.55) return true;
    if (/@font-face|@media\\s*\\(|@keyframes|var\\(--|\\bfunction\\s*\\(|\\bconst\\s+\\w+\\s*=/.test(sample)) return true;
    return false;
  }

  var pageLang = (document.documentElement.getAttribute('lang') || '').trim();
  var results = [];

  // Pass 1: declared
  document.querySelectorAll('[lang]').forEach(function(el) {
    if (el.tagName.toLowerCase() === 'html') return;

    var text = visibleText(el);

    if (!text) return;
    if (looksLikeCode(text)) return;

    results.push({
      mode: 'declared',
      selector: getSelector(el),
      outerHTML: el.outerHTML.slice(0, 300),
      declaredLang: el.getAttribute('lang') || '',
      textContent: text.slice(0, 500),
      elementTag: el.tagName.toLowerCase()
    });
  });

  // Pass 2: undeclared
  var blockSelectors = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, dt, dd, td, th';
  var seen = new Set();
  var candidates = [];
  var nodes = document.querySelectorAll(blockSelectors);

  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];

    // Skip if this element or any ancestor (except <html>) declares lang (already handled by pass 1)
    var declaredAncestor = el.closest('[lang]');
    if (declaredAncestor && declaredAncestor.tagName.toLowerCase() !== 'html') continue;

    var text = visibleText(el);
    if (text.length < ${MIN_UNDECLARED_TEXT_LENGTH}) continue;
    if (looksLikeCode(text)) continue;

    // Dedupe by trimmed text (template-driven pages repeat copy a lot).
    var key = text.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);

    var tag = el.tagName.toLowerCase();
    candidates.push({
      score: scoreCandidate(tag, text),
      selector: getSelector(el),
      outerHTML: el.outerHTML.slice(0, 300),
      declaredLang: '',
      fullText: text,
      textContent: text.slice(0, 500),
      elementTag: tag
    });
  }

  function isContained(shorter, longer) {
    if (shorter.length < 50) return false;
    if (shorter.length >= longer.length) return false;
    return longer.indexOf(shorter) !== -1;
  }

  var kept = []; // array of { fullText, item }
  var sorted = candidates.sort(function(a, b) { return b.score - a.score; });

  for (var s = 0; s < sorted.length; s++) {
    var item = sorted[s];
    var newText = item.fullText;
    var replaceIndex = -1;
    var dropNew = false;

    for (var k = 0; k < kept.length; k++) {
      var keptText = kept[k].fullText;
      if (isContained(newText, keptText)) {
        replaceIndex = k;
        break;
      }
      if (isContained(keptText, newText)) {
        dropNew = true;
        break;
      }
    }

    if (dropNew) continue;
    if (replaceIndex >= 0) {
      kept[replaceIndex] = { fullText: newText, item: item };
    } else {
      kept.push({ fullText: newText, item: item });
    }
  }

  // Apply the cap after dedupe
  kept.sort(function(a, b) { return b.item.score - a.item.score; });
  kept.slice(0, ${MAX_UNDECLARED}).forEach(function(entry) {
    var item = entry.item;
    results.push({
      mode: 'undeclared',
      selector: item.selector,
      outerHTML: item.outerHTML,
      declaredLang: item.declaredLang,
      textContent: item.textContent,
      elementTag: item.elementTag
    });
  });

  return { pageLang: pageLang, items: results };
}`;

export async function collectSC312Evidence(client: Client): Promise<EvidenceBundle[]> {
  const raw = await evaluate(client, COLLECT_SC312_JS);
  const collected = parseEvalJson<SC312Collected>(raw);
  const bundles: EvidenceBundle[] = [];

  for (const el of collected.items) {
    const evidence: SC312Evidence = {
      mode: el.mode,
      pageLang: collected.pageLang,
      declaredLang: el.declaredLang,
      textContent: el.textContent,
      elementTag: el.elementTag,
    };

    bundles.push({
      sc: '3.1.2',
      element: {
        selector: el.selector,
        outerHTML: el.outerHTML,
      },
      evidence: evidence as unknown as Record<string, unknown>,
    });
  }

  return bundles;
}