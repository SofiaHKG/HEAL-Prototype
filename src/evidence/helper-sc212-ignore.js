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