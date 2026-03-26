// Just a helper file that is not directly used in the main codebase
// but serves as a reference for how to collect the evidence for SC312.

// Collect every [lang] annotated element except the root <html>.
// Empty text-content elements are skipped (no content to assess)

function getSelector(el) {
  const tag = el.tagName.toLowerCase();

  const id = el.id;
  if (id) return tag + '#' + id;

  const className = typeof el.className === 'string' ? el.className.trim() : '';
  const firstClass = className ? className.split(/\s+/)[0] : null;

  if (firstClass) return tag + '.' + firstClass;

  return tag;
}

// Core extraction logic:
// DOM -> filtered elements -> mapped to structured data
const result = [...document.querySelectorAll('[lang]')]
  .filter(el => el.tagName.toLowerCase() !== 'html')
  .map(el => {
    const text = (el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) return null;

    return {
      declaredLang: el.getAttribute('lang') || '',
      textContent: text.slice(0, 500),
      elementTag: el.tagName.toLowerCase(),
      selector: getSelector(el),
      outerHTML: el.outerHTML.slice(0, 300)
    };
  })
  .filter(Boolean);



// Version above not compatible with how evaluate() is executed
// evalute(client, `() => { ... }`)
// Inside evaluate() everything must be inside a function and that fucntion must return a value
// 1. Wrap everything in a function (because Playwright executes "run this function in the browser context")
// 2. No ES module / TS style assumptions: so replace const result = ... with var results = [];
// 3. Must return result

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
