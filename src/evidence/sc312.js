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

const result = [...document.querySelectorAll('[lang]')]
  .filter(el => el.tagName.toLowerCase() !== 'html')
  .map(el => {
    const text = (el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) return null;

    return {
      declaredLang: el.getAttribute('lang') || '',
      textContent: text,
      elementTag: el.tagName.toLowerCase(),
      selector: getSelector(el),
    };
  })
  .filter(Boolean);