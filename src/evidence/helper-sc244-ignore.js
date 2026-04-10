// Just a helper file that is not directly used in the main codebase
// but serves as a reference for how to collect the evidence for SC 2.4.4.

// What elements are relevant for SC 2.4.4 (Link Purpose (In Context))?
// - Accessible name (aria-labelledby > aria-label > text content > title > alt)
// - The href value
// - Surrounding context text (nearest container ~400 chars)
// - Full ARIA snapshot (provides broader structural context for the LLM)

function resolveAriaLabelledby(el) {
  var ids = el.getAttribute('aria-labelledby');
  if (!ids) return null;

  var parts = ids.split(' ')
    .map(function(id) {
      var ref = document.getElementById(id);
      return ref ? (ref.textContent || '').trim() : '';
    })
    .filter(function(text) {
      return text.length > 0;
    });

  return parts.length > 0 ? parts.join(' ') : null;
}

function getAccessibleName(el) {
  var labelledby = resolveAriaLabelledby(el);
  if (labelledby) return labelledby;

  var ariaLabel = (el.getAttribute('aria-label') || '').trim();
  if (ariaLabel) return ariaLabel;

  var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (text) return text;

  var title = (el.getAttribute('title') || '').trim();
  if (title) return title;

  var alt = (el.getAttribute('alt') || '').trim();
  return alt;
}

function getSurroundingContext(el) {
  var parent =
    el.closest('p') ||
    el.closest('li') ||
    el.closest('td') ||
    el.closest('nav') ||
    el.closest('header') ||
    el.closest('footer') ||
    el.closest('section') ||
    el.closest('article') ||
    el.parentElement;

  if (!parent || parent === el) return '';

  return (parent.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function getSelector(el) {
  var tag = el.tagName.toLowerCase();

  if (el.id) return tag + '#' + el.id;

  var href = el.getAttribute('href');
  if (href) {
    return tag + '[href="' + href.slice(0, 60).replace(/"/g, "'") + '"]';
  }

  var rawCls = typeof el.className === 'string' ? el.className.trim() : '';
  var cls = rawCls.length > 0 ? rawCls.split(' ')[0] : null;

  return cls ? (tag + '.' + cls) : tag;
}

var results = [];