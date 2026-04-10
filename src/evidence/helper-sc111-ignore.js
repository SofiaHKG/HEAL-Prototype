// What elements are relevant for SC 1.1.1 (Non-text Content)?
// - <img> elements
// - Elements with role="img" (non-img tags)
// - <input type="image"> elements


// 1. Query all <img>, role="img", <input type="image"> via evaluate()
// 2. For each: extract outerHTML, alt attribute, aria-label, aria-labelledby resolved text
// 3. For each: take element-level screenshot (clip to bounding box)
// 4. Bundle: { altText, ariaName, role, screenshotBase64, surroundingText }

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



// Wrap into intectable string
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