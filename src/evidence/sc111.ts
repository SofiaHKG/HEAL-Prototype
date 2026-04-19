import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { evaluate, screenshot, snapshot } from '../mcp/tools';
import type { EvidenceBundle, SC111Evidence } from '../types/finding';
import { parseEvalJson } from '../mcp/evalUtils';

function parseSnapshotImgRefs(snap: string): { ref: string; alt: string }[] {
  const out: { ref: string; alt: string }[] = [];
  // Match optional opening quote, "img", optional alt in quotes, then [ref=eN]
  const re = /\bimg(?:\s+"((?:[^"\\]|\\.)*)")?[^[\n]*\[ref=(e\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snap)) !== null) {
    out.push({ ref: m[2]!, alt: (m[1] ?? '').replace(/\\(.)/g, '$1') });
  }
  return out;
}

function pickRefForImage(
  pool: { ref: string; alt: string }[],
  altText: string | null,
): string | null {
  const wanted = (altText ?? '').trim();
  // Prefer same-alt match (handles repeated empty-alt decorative images by FIFO)
  const idx = pool.findIndex((r) => r.alt.trim() === wanted);
  if (idx >= 0) {
    const [picked] = pool.splice(idx, 1);
    return picked!.ref;
  }
  return null;
}

interface SC111Data {
  selector: string;
  outerHTML: string;
  altText: string | null;
  ariaLabel: string | null;
  ariaLabelledbyText: string | null;
  role: string;
  surroundingText: string;
  parentLinkHref: string | null;
  parentButtonLabel: string | null;
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
    if (el.id) {
      return el.tagName.toLowerCase() + '#' + CSS.escape(el.id);
    }
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      var part = cur.tagName.toLowerCase();
      var p = cur.parentElement;
      if (p) {
        var sameTag = Array.prototype.filter.call(p.children,
          function (s) { return s.tagName === cur.tagName; });
        if (sameTag.length > 1) {
          part += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
        }
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function isVisible(el) {
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getButtonAccessibleName(btn) {
    var labelledby = resolveAriaLabelledby(btn);
    if (labelledby) return labelledby;
    var ariaLabel = (btn.getAttribute('aria-label') || '').trim();
    if (ariaLabel) return ariaLabel;
    var text = (btn.textContent || '').replace(/\\s+/g, ' ').trim();
    if (text) return text;
    var title = (btn.getAttribute('title') || '').trim();
    return title || null;
  }

  function getParentLinkHref(el) {
    var link = el.closest('a[href], area[href]');
    if (!link || link === el) return null;
    var href = link.getAttribute('href');
    return href || null;
  }

  function getParentButtonLabel(el) {
    var btn = el.closest('button, [role="button"]');
    if (!btn || btn === el) return null;
    return getButtonAccessibleName(btn);
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
      parentLinkHref: getParentLinkHref(el),
      parentButtonLabel: getParentButtonLabel(el),
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
  const snap = await snapshot(client);
  const refPool = parseSnapshotImgRefs(snap);

  const bundles: EvidenceBundle[] = [];

  for (const img of images) {
    let screenshotBase64: string | null = null;
    let screenshotMimeType: string | null = null;

    if (img.isVisible) {
      const ref = pickRefForImage(refPool, img.altText);
      if (ref !== null) {
        const elementDesc =
          img.altText?.trim() ||
          img.ariaLabel?.trim() ||
          img.ariaLabelledbyText?.trim() ||
          'image';
        const shot = await screenshot(client, { element: elementDesc, ref });
        if (shot !== null) {
          screenshotBase64 = shot.data;
          screenshotMimeType = shot.mimeType;
        }
      }
    }

    const evidence: SC111Evidence = {
      altText: img.altText,
      ariaLabel: img.ariaLabel,
      ariaLabelledbyText: img.ariaLabelledbyText,
      role: img.role,
      surroundingText: img.surroundingText,
      parentLinkHref: img.parentLinkHref,
      parentButtonLabel: img.parentButtonLabel,
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