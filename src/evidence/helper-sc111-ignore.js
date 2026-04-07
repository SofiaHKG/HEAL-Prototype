// What elements are relevant for SC 1.1.1 (Non-text Content)?
// - <img> elements
// - Elements with role="img" (non-img tags)
// - <input type="image"> elements

var results = [];

var images = document.querySelectorAll('img');

images.forEach(function(el) {
  results.push({
    tag: el.tagName.toLowerCase(),
    alt: el.getAttribute('alt')
  });
});

return results;