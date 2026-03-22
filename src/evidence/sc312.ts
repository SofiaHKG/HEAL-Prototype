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

