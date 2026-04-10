interface SC244Data {
  selector: string;
  outerHTML: string;
  accessibleName: string;
  linkHref: string;
  surroundingContext: string;
  role: string;
}

const COLLECT_SC244_JS = `() => {
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

  function getAccessibleName(el) {
    var labelledby = resolveAriaLabelledby(el);
    if (labelledby) return labelledby;

    var ariaLabel = (el.getAttribute('aria-label') || '').trim();
    if (ariaLabel) return ariaLabel;

    var textContent = (el.textContent || '')
      .replace(/\\s+/g, ' ')
      .trim();

    if (textContent) return textContent;

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

    var text = (parent.textContent || '')
      .replace(/\\s+/g, ' ')
      .trim();

    return text.slice(0, 400);
  }

  function getSelector(el) {
    var tag = el.tagName.toLowerCase();

    var id = el.id;
    if (id) return tag + '#' + id;

    var href = el.getAttribute('href');
    if (href) {
      var shortHref = href
        .slice(0, 60)
        .replace(/"/g, "'");
      return tag + '[href="' + shortHref + '"]';
    }

    var className =
      typeof el.className === 'string' ? el.className.trim() : '';

    var firstClass = className
      ? className.split(/\\s+/)[0]
      : null;

    if (firstClass) return tag + '.' + firstClass;

    return tag;
  }

  var results = [];

  document.querySelectorAll('a[href], area[href]').forEach(function(el) {
    results.push({
      selector: getSelector(el),
      outerHTML: el.outerHTML.slice(0, 500),
      accessibleName: getAccessibleName(el),
      linkHref: el.getAttribute('href') || '',
      surroundingContext: getSurroundingContext(el),
      role: el.getAttribute('role') || el.tagName.toLowerCase()
    });
  });

  return results;
}`;