import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import sharp from 'sharp';
import { evaluate } from '../mcp/tools';
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
  parentLinkHref: string | null;
  parentLinkLabel: string | null;
  parentButtonLabel: string | null;
  isVisible: boolean;
  ariaHidden: boolean;
  screenshotBase64: string | null;
  screenshotMimeType: string | null;
  resolvedSrc: string | null;
}

const COLLECT_SC111_JS = `async () => {
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

  function getLinkAccessibleName(link) {
    var labelledby = resolveAriaLabelledby(link);
    if (labelledby) return labelledby;
    var ariaLabel = (link.getAttribute('aria-label') || '').trim();
    if (ariaLabel) return ariaLabel;
    var title = (link.getAttribute('title') || '').trim();
    if (title) return title;
    var text = (link.textContent || '').replace(/\s+/g, ' ').trim();
    return text || null;
  }

  function getParentLinkHref(el) {
    var link = el.closest('a[href], area[href]');
    if (!link || link === el) return null;
    var href = link.getAttribute('href');
    return href || null;
  }

  function getParentLinkLabel(el) {
    var link = el.closest('a[href], area[href]');
    if (!link || link === el) return null;
    return getLinkAccessibleName(link);
  }

  function getParentButtonLabel(el) {
    var btn = el.closest('button, [role="button"]');
    if (!btn || btn === el) return null;
    return getButtonAccessibleName(btn);
  }

  function getResolvedSrc(el) {
    var tag = el.tagName;
    if (tag === 'IMG') {
      var s = el.currentSrc || el.src || '';
      return s || null;
    }
    if (tag === 'INPUT' && el.type === 'image') {
      return el.src || null;
    }
    return null;
  }

  function buildEntry(el, role) {
    return {
      selector: getSelector(el),
      outerHTML: el.outerHTML.slice(0, 500),
      altText: el.getAttribute('alt'),
      ariaHidden: el.getAttribute('aria-hidden') === 'true',
      ariaLabel: el.getAttribute('aria-label'),
      ariaLabelledbyText: resolveAriaLabelledby(el),
      role: role,
      surroundingText: getSurroundingText(el),
      parentLinkHref: getParentLinkHref(el),
      parentLinkLabel: getParentLinkLabel(el),
      parentButtonLabel: getParentButtonLabel(el),
      isVisible: isVisible(el),
      screenshotBase64: null,
      screenshotMimeType: null,
      resolvedSrc: getResolvedSrc(el)
    };
  }

  // Encode an HTMLImageElement (already loaded) into a base64 PNG via canvas
  // (returns null if the canvas is CORS-tainted or any rendering error occurs)
  function encodeToPng(imgEl, naturalW, naturalH) {
    try {
      var MAX = 1024;
      var scale = Math.min(1, MAX / Math.max(naturalW, naturalH));
      var cw = Math.max(1, Math.round(naturalW * scale));
      var ch = Math.max(1, Math.round(naturalH * scale));
      var c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      var ctx = c.getContext('2d');
      ctx.drawImage(imgEl, 0, 0, cw, ch);
      var url = c.toDataURL('image/png');
      var idx = url.indexOf(',');
      return idx >= 0 ? { data: url.slice(idx + 1), mime: 'image/png' } : null;
    } catch (e) {
      return null;
    }
  }

  // Re-fetch image bytes via fetch() in CORS mode and convert directly to a base64 data URL
  async function fetchAsBase64(src) {
    try {
      var resp = await fetch(src, { mode: 'cors', cache: 'reload', credentials: 'omit' });
      if (!resp.ok) return null;
      var blob = await resp.blob();
      var mime = blob.type || 'application/octet-stream';
      var dataUrl = await new Promise(function(resolve, reject) {
        var fr = new FileReader();
        fr.onload = function() { resolve(fr.result); };
        fr.onerror = function() { reject(fr.error); };
        fr.readAsDataURL(blob);
      });
      var s = String(dataUrl);
      var idx = s.indexOf(',');
      if (idx < 0) return null;
      var b64 = s.slice(idx + 1);

      // Anthropic vision only accepts png/jpeg/gif/webp -> rasterise SVG via canvas
      if (mime === 'image/svg+xml') {
        var rendered = await new Promise(function(resolve) {
          var img = new Image();
          img.onload = function() {
            var w = img.naturalWidth || 256;
            var h = img.naturalHeight || 256;
            resolve(encodeToPng(img, w, h));
          };
          img.onerror = function() { resolve(null); };
          img.src = s;
        });
        return rendered;
      }
      return { data: b64, mime: mime };
    } catch (e) {
      return null;
    }
  }

  // Capture pixel data for an element:
  // Tries direct canvas draw first
  // If CORS taint or unsuported source, falls back to a CORS fetch of the src
  async function capturePixels(el) {
    var tag = el.tagName;
    var isImg = tag === 'IMG';
    var isInputImage = tag === 'INPUT' && el.type === 'image';
    if (!isImg && !isInputImage) return null;

    var src = isImg ? (el.currentSrc || el.src) : el.src;
    if (!src) return null;

    if (el.complete && el.naturalWidth && el.naturalHeight) {
      var direct = encodeToPng(el, el.naturalWidth, el.naturalHeight);
      if (direct) return direct;
    }
    return await fetchAsBase64(src);
  }

  var entries = [];

  document.querySelectorAll('img').forEach(function(el) {
    var role = el.getAttribute('role') || 'img';
    entries.push({ el: el, entry: buildEntry(el, role) });
  });

  document.querySelectorAll('[role="img"]').forEach(function(el) {
    if (el.tagName.toLowerCase() === 'img') return;
    entries.push({ el: el, entry: buildEntry(el, 'img') });
  });

  document.querySelectorAll('input[type="image"]').forEach(function(el) {
    entries.push({ el: el, entry: buildEntry(el, 'input-image') });
  });

  // Capture pixels in parallel and only retain mime types Anthropic vision accepts
  var ALLOWED_MIME = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1 };
  await Promise.all(entries.map(async function(item) {
    var captured = await capturePixels(item.el);
    if (captured && captured.data && ALLOWED_MIME[captured.mime]) {
      item.entry.screenshotBase64 = captured.data;
      item.entry.screenshotMimeType = captured.mime;
    }
  }));

  return entries.map(function(item) { return item.entry; });
}`;


// MIME types accepted by Anthropic vision; everything else is dropped.
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
// Cap downloaded image size
const MAX_FALLBACK_BYTES = 20 * 1024 * 1024;
// Per-request timeout for the Node-side fallback fetch
const FALLBACK_FETCH_TIMEOUT_MS = 25000;
const MAX_IMAGE_EDGE_PX = 1600;
const MAX_ENCODED_BYTES = 4 * 1024 * 1024; // safe under the 5 MB API limit

/**
 * Resize an image buffer down to MAX_IMAGE_EDGE_PX on its longest side and
 * re-encode as JPEG (quality 82). Returns the original buffer unchanged if
 * it's already small enough on both axes. Falls back to the original buffer
 * if sharp fails to decode (e.g. animated webp edge cases).
 */
async function downscaleImage(
  buf: Buffer,
  mime: string,
): Promise<{ data: Buffer; mimeType: string }> {
  try {
    const meta = await sharp(buf).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w <= MAX_IMAGE_EDGE_PX && h <= MAX_IMAGE_EDGE_PX && buf.byteLength <= MAX_ENCODED_BYTES) {
      return { data: buf, mimeType: mime };
    }
    const resized = await sharp(buf)
      .rotate() // honor EXIF orientation
      .resize({ width: MAX_IMAGE_EDGE_PX, height: MAX_IMAGE_EDGE_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    return { data: resized, mimeType: 'image/jpeg' };
  } catch {
    // If sharp can't handle it, return the original only when it fits.
    return buf.byteLength <= MAX_ENCODED_BYTES
      ? { data: buf, mimeType: mime }
      : { data: buf.subarray(0, 0), mimeType: mime };
  }
}

/**
 * Re-download an image's bytes from Node where CORS does not apply, then
 * base64-encode. Used to recover pixel evidence for cross-origin CDN images
 * which the in-page canvas/fetch path cannot capture.
 *
 * Returns null for non-http(s) URLs, network/HTTP errors, MIME
 * types that are not allowed (SVG) or payloads exceeding MAX_FALLBACK_BYTES.
 */
async function fetchImageFromNode(
  src: string,
  pageUrl: string,
): Promise<{ data: string; mimeType: string } | null> {
  let url: URL;
  try {
    url = new URL(src, pageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FALLBACK_FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url.toString(), {
      headers: {
        Referer: pageUrl,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HEAL-evidence/1.0',
        Accept: 'image/webp,image/jpeg,image/png,image/gif;q=0.9,*/*;q=0.1',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!resp.ok) {
      console.warn('[sc111] fetch failed ' + resp.status + ' ' + url.toString());
      return null;
    }

    const mime = ((resp.headers.get('content-type') || '').split(';')[0] || '').trim().toLowerCase();
    if (!ALLOWED_IMAGE_MIME.has(mime)) {
      console.warn('[sc111] unsupported mime ' + mime + ' for ' + url.toString());
      return null;
    }

    const buf = await resp.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_FALLBACK_BYTES) {
      console.warn('[sc111] size ' + buf.byteLength + ' out of bounds for ' + url.toString());
      return null;
    }

    // Downscale huge originals to keep payload under Anthropic vision's per-image cap
    const shrunk = await downscaleImage(Buffer.from(buf), mime);
    if (shrunk.data.byteLength === 0) {
      console.warn('[sc111] downscale dropped image for ' + url.toString());
      return null;
    }

    return { data: shrunk.data.toString('base64'), mimeType: shrunk.mimeType };
  } catch (err) {
    console.warn('[sc111] fetch error for ' + url.toString() + ': ' + (err instanceof Error ? err.message : String(err)));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Collect SC 1.1.1 evidence for all image elements on currently loaded page
export async function collectSC111Evidence(client: Client, pageUrl?: string): Promise<EvidenceBundle[]> {
  const raw = await evaluate(client, COLLECT_SC111_JS);
  const images = parseEvalJson<SC111Data[]>(raw);

  // Fallback
  if (pageUrl) {
    await Promise.all(
      images.map(async (img) => {
        if (img.screenshotBase64 !== null) return;
        if (!img.resolvedSrc) return;
        const fetched = await fetchImageFromNode(img.resolvedSrc, pageUrl);
        if (fetched) {
          img.screenshotBase64 = fetched.data;
          img.screenshotMimeType = fetched.mimeType;
        }
      }),
    );
  }

  const bundles: EvidenceBundle[] = [];

  for (const img of images) {
    const evidence: SC111Evidence = {
      altText: img.altText,
      ariaHidden: img.ariaHidden,
      ariaLabel: img.ariaLabel,
      ariaLabelledbyText: img.ariaLabelledbyText,
      role: img.role,
      surroundingText: img.surroundingText,
      parentLinkHref: img.parentLinkHref,
      parentLinkLabel: img.parentLinkLabel,
      parentButtonLabel: img.parentButtonLabel,
      screenshotBase64: img.screenshotBase64,
      screenshotMimeType: img.screenshotMimeType,
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