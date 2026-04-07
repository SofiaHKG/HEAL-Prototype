import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { evaluate, screenshot } from '../mcp/tools';
import type { EvidenceBundle, SC111Evidence } from '../types/finding';
import { parseEvalJson } from '../mcp/evalUtils';

interface SC111Data {
  selector: string;
  outerHTML: string;
  altText: string | null;
  ariaLabel: string | null;
  ariaLabelledbyText: string | null;
  role: string;
  surroundingText: string;
  isVisible: boolean;
}

const COLLECT_SC111_JS = `() => {
  function resolveAriaLabelledby(el) {
    var ids = el.getAttribute('aria-labelledby');
    if (!ids) return null;

    var parts = ids
      .split(/\\s+/)
      .map(function(id) {
        var ref = document.getElementById(id);
        return ref ? (ref.textContent || '').trim() : '';
      })
      .filter(function(text) {
        return text.length > 0;
      });

    return parts.length > 0 ? parts.join(' ') : null;
  }

  function getSurroundingText(el) {
    var parent =
      el.closest('figure') ||
      el.closest('picture') ||
      el.closest('p') ||
      el.closest('li') ||
      el.closest('td') ||
      el.closest('article') ||
      el.closest('section') ||
      el.parentElement;

    if (!parent) return '';

    var text = (parent.textContent || '')
      .replace(/\\s+/g, ' ')
      .trim();

    return text.slice(0, 300);
  }

  function getSelector(el) {
    var tag = el.tagName.toLowerCase();

    var id = el.id;
    if (id) return tag + '#' + id;

    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return tag + '[aria-label]';

    var className =
      typeof el.className === 'string' ? el.className.trim() : '';

    var firstClass = className
      ? className.split(/\\s+/)[0]
      : null;

    if (firstClass) return tag + '.' + firstClass;

    return tag;
  }

  function isVisible(el) {
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function buildEntry(el, role) {
    return {
      selector: getSelector(el),
      outerHTML: el.outerHTML.slice(0, 500),
      altText: el.getAttribute('alt'),
      ariaLabel: el.getAttribute('aria-label'),
      ariaLabelledbyText: resolveAriaLabelledby(el),
      role: role,
      surroundingText: getSurroundingText(el),
      isVisible: isVisible(el)
    };
  }

  var results = [];

  document.querySelectorAll('img').forEach(function(el) {
    var role = el.getAttribute('role') || 'img';
    results.push(buildEntry(el, role));
  });

  document.querySelectorAll('[role="img"]').forEach(function(el) {
    if (el.tagName.toLowerCase() === 'img') return;
    results.push(buildEntry(el, 'img'));
  });

  document.querySelectorAll('input[type="image"]').forEach(function(el) {
    results.push(buildEntry(el, 'input-image'));
  });

  return results;
}`;


// Collect SC 1.1.1 evidence for all image elements on currently loaded page
export async function collectSC111Evidence(client: Client): Promise<EvidenceBundle[]> {
  const raw = await evaluate(client, COLLECT_SC111_JS);
  const images = parseEvalJson<SC111Data[]>(raw);

  const bundles: EvidenceBundle[] = [];

  for (const img of images) {
    // Take an element-scoped screenshot (only if the element is visible)
    let screenshotBase64: string | null = null;
    let screenshotMimeType: string | null = null;

    if (img.isVisible) {
      const shot = await screenshot(client, { selector: img.selector });
      if (shot !== null) {
        screenshotBase64 = shot.data;
        screenshotMimeType = shot.mimeType;
      }
    }

    const evidence: SC111Evidence = {
      altText: img.altText,
      ariaLabel: img.ariaLabel,
      ariaLabelledbyText: img.ariaLabelledbyText,
      role: img.role,
      surroundingText: img.surroundingText,
      screenshotBase64,
      screenshotMimeType,
    };

    bundles.push({
      sc: '1.1.1',
      element: {
        selector: img.selector,
        outerHTML: img.outerHTML,
        ariaRole: img.role,
        // Use the first available accessible name as computedName
        computedName:
          img.ariaLabelledbyText ??
          img.ariaLabel ??
          img.altText ??
          undefined,
      },
      evidence: evidence as unknown as Record<string, unknown>,
    });
  }

  return bundles;
}