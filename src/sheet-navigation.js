/* One temporary history entry for the top modal layer, including Android/browser Back. */
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else { window.SheetNavigation = factory(window); window.SheetNavigation.install(); }
})(function (root) {
  'use strict';
  var active = false, pending = false, installed = false;
  var marker = '__rgzOverlay', token = 'overlay-' + Date.now() + '-' + Math.random();
  function sheet() { var el = root.document.getElementById('sheet'); return el && el.classList.contains('on'); }
  function confirmation() { var el = root.document.getElementById('cfMask'); return el && (!el.dataset || el.dataset.state !== 'closing') ? el : null; }
  function visible() { return sheet() || !!confirmation(); }
  function marked() { return root.history.state && root.history.state[marker] === token; }
  function opened() {
    if (!root.history || active || pending) return;
    try {
      var state = Object.assign({}, root.history.state || {}); state[marker] = token;
      root.history.pushState(state, '', root.location.href); active = true;
    } catch (_) { /* A disabled History API must not stop the close controls. */ }
  }
  function closed() {
    if (visible() || !active) return;
    active = false;
    if (marked()) { pending = true; root.history.back(); }
  }
  function onBack() {
    if (pending) {
      pending = false;
      if (visible()) opened();
      return;
    }
    if (!active) return;
    active = false;
    var top = confirmation();
    if (top) {
      var cancel = top.querySelector('[data-cf="0"]');
      if (typeof top.__dismiss === 'function') top.__dismiss();
      else if (cancel) cancel.click();
      if (sheet()) opened();
    } else if (sheet()) root.UI.closeSheet();
  }
  function install() {
    if (installed || !root.history) return;
    installed = true; root.addEventListener('popstate', onBack);
    if (visible()) opened();
  }
  return {install:install, opened:opened, closed:closed};
});
