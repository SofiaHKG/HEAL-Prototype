// What elements are relevant for SC 1.1.1 (Non-text Content)?
// - <img> elements
// - Elements with role="img" (non-img tags)
// - <input type="image"> elements

function resolveAriaLabelledby(el) {
  var ids = el.getAttribute('aria-labelledby');
  if (!ids) return null;

  return ids
    .split(/\\s+/)
    .map(function(id) {
      var ref = document.getElementById(id);
      return ref ? (ref.textContent || '').trim() : '';
    })
    .filter(function(text) {
      return text.length > 0;
    })
    .join(' ') || null;
}

function getSurroundingText(el) {
  var parent =
    el.closest('p') ||
    el.closest('li') ||
    el.parentElement;

  if (!parent) return '';

  return (parent.textContent || '')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function getSelector(el) {
  var tag = el.tagName.toLowerCase();

  if (el.id) return tag + '#' + el.id;

  var className =
    typeof el.className === 'string' ? el.className.trim() : '';

  var firstClass = className
    ? className.split(/\\s+/)[0]
    : null;

  return firstClass ? tag + '.' + firstClass : tag;
}

function buildEntry(el, role) {
  return {
    selector: getSelector(el),
    altText: el.getAttribute('alt'),
    ariaLabel: el.getAttribute('aria-label'),
    ariaLabelledbyText: resolveAriaLabelledby(el),
    role: role,
    surroundingText: getSurroundingText(el)
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