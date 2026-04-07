import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { evaluate } from '../mcp/tools';
import type { EvidenceBundle, SC312Evidence } from '../types/finding';
import { parseEvalJson } from '../mcp/evalUtils';

interface SC312Data {
  selector: string;
  outerHTML: string;
  declaredLang: string;
  textContent: string;
  elementTag: string;
}

/**
 * Collect every [lang] annotated element except the root <html>.
 * Empty text-content elements are skipped (no content to assess)
 */
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

  var results = [];

  document.querySelectorAll('[lang]').forEach(function(el) {
    if (el.tagName.toLowerCase() === 'html') return;

    var text = (el.textContent || '')
      .replace(/\\s+/g, ' ')
      .trim();

    if (!text) return;

    results.push({
      selector: getSelector(el),
      outerHTML: el.outerHTML.slice(0, 300),
      declaredLang: el.getAttribute('lang') || '',
      textContent: text.slice(0, 500),
      elementTag: el.tagName.toLowerCase()
    });
  });

  return results;
}`;

/**
 * Collect SC 3.1.2 evidence for all language-annotated elements on the page
 */
export async function collectSC312Evidence(client: Client): Promise<EvidenceBundle[]> {
  const raw = await evaluate(client, COLLECT_SC312_JS);
  const elements = parseEvalJson<SC312Data[]>(raw);
  const bundles: EvidenceBundle[] = [];

  for (const el of elements) {
    const evidence: SC312Evidence = {
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