// Collect every [lang] annotated element except the root <html>.
// Empty text-content elements are skipped (no content to assess)

const result = [...document.querySelectorAll('[lang]')]
  .map(el => ({
    declaredLang: el.getAttribute('lang'),
    textContent: el.textContent,
    elementTag: el.tagName,
  }));