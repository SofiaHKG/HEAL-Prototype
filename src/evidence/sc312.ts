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

const MAX_UNDECLARED = 20;
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

  var pageLang = (document.documentElement.getAttribute('lang') || '').trim();
  var results = [];

  // Pass 1: declared
  document.querySelectorAll('[lang]').forEach(function(el) {
    if (el.tagName.toLowerCase() === 'html') return;

    var text = (el.textContent || '')
      .replace(/\\s+/g, ' ')
      .trim();

    if (!text) return;

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
  var blockSelectors = 'p, li, h1, h2, h3, h4';
  var seen = new Set();
  var undeclaredCount = 0;
  var nodes = document.querySelectorAll(blockSelectors);

  for (var i = 0; i < nodes.length && undeclaredCount < ${MAX_UNDECLARED}; i++) {
    var el = nodes[i];

    // Skip if this element or any ancestor (except <html>) declares lang —
    // that case is already handled by pass 1.
    var declaredAncestor = el.closest('[lang]');
    if (declaredAncestor && declaredAncestor.tagName.toLowerCase() !== 'html') continue;

    var text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text.length < ${MIN_UNDECLARED_TEXT_LENGTH}) continue;

    // Dedupe by trimmed text (template-driven pages repeat copy a lot).
    var key = text.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      mode: 'undeclared',
      selector: getSelector(el),
      outerHTML: el.outerHTML.slice(0, 300),
      declaredLang: '',
      textContent: text.slice(0, 500),
      elementTag: el.tagName.toLowerCase()
    });
    undeclaredCount++;
  }

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