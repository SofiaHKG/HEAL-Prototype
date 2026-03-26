// What elements are relevant for SC 3.1.2 (Language of Parts)?
// - Elements with a [lang] attribute (declared language)
// - Their text content (language used in the content)
// - The element tag (to understand the context of the language declaration)
// - Exclude <html lang="..."> element as it is covered by SC 3.1.1 (Language of Page)

// Example:
/*
<div lang="fr">Bonjour</div>
*/

// Dom query for DevTools console to collect relevant info for SC 3.1.2
/*
document.querySelectorAll('[lang]')
*/

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