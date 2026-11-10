/* Local feedback for confirmed record updates; this module never changes habit data. */
(function (factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else {
    window.InteractionFeedback = factory(window);
    window.InteractionFeedback.install();
  }
})(function (root) {
  'use strict';
  var active = new Map();
  var installed = false;
  var media = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function reduced() { return !!(media && media.matches); }
  function clear(id) {
    var group = active.get(id);
    if (!group) return;
    active.delete(id);
    group.animations.forEach(function (animation) { animation.cancel(); });
    group.rings.forEach(function (ring) { ring.remove(); });
  }
  function cancelAll() { Array.from(active.keys()).forEach(clear); }
  function finish(id, group, animation) {
    group.animations.delete(animation);
    if (group.animations.size) return;
    group.rings.forEach(function (ring) { ring.remove(); });
    if (active.get(id) === group) active.delete(id);
  }
  function animate(id, group, element, frames, duration) {
    if (!element || typeof element.animate !== 'function') return;
    try {
      var animation = element.animate(frames, {
        id: 'rg-feedback',
        duration: duration,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'none'
      });
      if (!animation.finished || typeof animation.finished.then !== 'function') { animation.cancel(); return; }
      group.animations.add(animation);
      animation.finished.then(function () { finish(id, group, animation); }, function () { finish(id, group, animation); });
    } catch (_) { /* Recording still succeeds when animation is unavailable. */ }
  }
  function update(id, completed) {
    clear(id);
    var doc = root.document;
    if (!doc || doc.hidden || reduced()) return;
    var row = Array.from(doc.querySelectorAll('.hitem,.p-tile-wrap')).find(function (element) {
      return element.dataset.id === id && element.isConnected;
    });
    if (!row) return;
    var group = {animations: new Set(), rings: []};
    active.set(id, group);
    if (completed) {
      var mark = row.querySelector('.tick svg,.p-tile-done');
      animate(id, group, mark, [
        {transform: 'scale(.72)', opacity: .45},
        {transform: 'scale(1.12)', opacity: 1, offset: .55},
        {transform: 'scale(1)', opacity: 1}
      ], 240);
      var anchor = row.querySelector('.tick,.p-tile-ring');
      if (anchor && typeof anchor.animate === 'function') {
        var ring = doc.createElement('span');
        ring.className = 'rg-feedback-ring';
        ring.setAttribute('aria-hidden', 'true');
        anchor.appendChild(ring);
        group.rings.push(ring);
        animate(id, group, ring, [
          {transform: 'scale(.9)', opacity: .5},
          {transform: 'scale(1.3)', opacity: 0}
        ], 320);
      }
    } else {
      var value = row.querySelector('.stepper .val,.p-tile-num') || row.querySelector('.tick svg,.p-tile-symbol');
      animate(id, group, value, [
        {transform: 'translateY(2px)', opacity: .65},
        {transform: 'translateY(0)', opacity: 1}
      ], 140);
    }
    if (!group.animations.size) {
      group.rings.forEach(function (ring) { ring.remove(); });
      active.delete(id);
    }
  }
  function syncMotionPreference() {
    var shouldReduce = reduced();
    if (root.FX && typeof root.FX.setReduced === 'function') root.FX.setReduced(shouldReduce);
    if (shouldReduce) {
      cancelAll();
      root.document.querySelectorAll('#fxLayer,.celeb').forEach(function (element) { element.remove(); });
    }
  }
  function install() {
    if (installed || !root.document) return;
    installed = true;
    syncMotionPreference();
    root.document.addEventListener('rigong:before-render', cancelAll);
    root.document.addEventListener('visibilitychange', function () {
      if (root.document.hidden) cancelAll();
    });
    if (media) {
      var changed = syncMotionPreference;
      if (media.addEventListener) media.addEventListener('change', changed);
      else if (media.addListener) media.addListener(changed);
    }
  }
  return {install: install, update: update, cancelAll: cancelAll};
});
