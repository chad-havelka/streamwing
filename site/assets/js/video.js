// Big play button on video. Shows in the middle of the video while it is paused (including before it starts).
(function () {
  'use strict';
  function wrap(v) {
    if (!v || v.getAttribute('data-bigplay-done') !== null || !v.parentNode) return;
    v.setAttribute('data-bigplay-done', '');
    var box = document.createElement('div');
    box.className = 'vid';
    v.parentNode.insertBefore(box, v);
    box.appendChild(v);
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'vid-play';
    b.setAttribute('aria-label', 'Play video');
    b.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
    box.appendChild(b);
    function sync() { box.classList.toggle('is-paused', v.paused); }
    b.addEventListener('click', function () { v.play(); });
    v.addEventListener('play', sync);
    v.addEventListener('pause', sync);
    v.addEventListener('ended', sync);
    sync();
  }
  function scan() {
    document.querySelectorAll('video[data-bigplay]').forEach(wrap);
  }
  window.swVideo = { wrap: wrap, scan: scan };
  scan();
  document.addEventListener('DOMContentLoaded', scan);
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
