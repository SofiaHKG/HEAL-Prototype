// What elements are relevant for SC 1.1.1 (Non-text Content)?
// - <img> elements
// - Elements with role="img" (non-img tags)
// - <input type="image"> elements

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

function buildEntry(el) {
  return {
    selector: getSelector(el),
    outerHTML: el.outerHTML.slice(0, 200),
    altText: el.getAttribute('alt')
  };
}

var results = [];

document.querySelectorAll('img').forEach(function(el) {
  results.push(buildEntry(el));
});

return results;