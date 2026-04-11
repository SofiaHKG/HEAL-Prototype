// Focus the first keyboard-reachable element -> returns true if any found
function focusFirstKeyboardElement() {
  var firstFocusableSelector = [
    'a[href]','button:not([disabled])',
    'input:not([type=hidden]):not([disabled])',
    'select:not([disabled])','textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  var el = document.querySelector(firstFocusableSelector);

  if (el && typeof el.focus === 'function') {
    el.focus();
  }

  return !!el;
}

// Returns the count of keyboard-focusable elements on the page
function countKeyboardFocusableElements() {
  var focusableCountSelector = [
    'a[href]','button:not([disabled])',
    'input:not([type=hidden]):not([disabled])',
    'select:not([disabled])','textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  return document.querySelectorAll(focusableCountSelector).length;
}

// Returns info about document.activeElement or null if focus is on body/root
function getSelector(el) {
  var tag = el.tagName.toLowerCase();

  var id = el.id ? el.id.trim() : '';
  if (id) return tag + '#' + id;

  var className =
    typeof el.className === 'string' ? el.className.trim() : '';

  var firstClass = className
    ? className.split(/\\s+/)[0]
    : null;

  if (firstClass) return tag + '.' + firstClass;

  return tag;
}

var el = document.activeElement;

if (!el || el === document.body || el === document.documentElement) {
  return null;
}

var id = el.id ? el.id.trim() : null;
var tag = el.tagName.toLowerCase();

return {
  selector: getSelector(el),
  tagName: tag,
  id: id
};