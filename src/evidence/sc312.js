// Collect every [lang] annotated element except the root <html>.
// Empty text-content elements are skipped (no content to assess)

const result = [...document.querySelectorAll('[lang]')]
  .filter(el => {
    if (el.tagName.toLowerCase() === 'html') return false;

    const text = (el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();

    return text.length > 0;
  })
  .map(el => {
    const text = (el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      declaredLang: el.getAttribute('lang'),
      textContent: text,
      elementTag: el.tagName.toLowerCase(),
    };
  });