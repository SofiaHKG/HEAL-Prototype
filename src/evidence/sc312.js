// Collect every [lang] annotated element except the root <html>.
// Empty text-content elements are skipped (no content to assess)

const result = [...document.querySelectorAll('[lang]')]
  .filter(el => {
    if (el.tagName.toLowerCase() === 'html') return false;

    const text = (el.textContent || '').trim();
    return text.length > 0;
  })
  .map(el => ({
    declaredLang: el.getAttribute('lang'),
    textContent: el.textContent,
    elementTag: el.tagName.toLowerCase(),
  }));