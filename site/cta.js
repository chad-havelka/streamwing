// Early-access vs connect call-to-action.
// A visitor who has opened her StreamWing panel on this device is a performer, so the
// main call-to-action becomes "Connect your Chaturbate room" and turns yellow.
// The flag lives only in this browser (localStorage). Nothing is sent anywhere.
(function () {
  var KEY = 'sw_performer';
  var CONNECT_TEXT = 'Connect your Chaturbate room';
  var CONNECT_HREF = '/connect-to-chaturbate/';
  var style = document.createElement('style');
  style.textContent = '.cta-yellow{background:#facc15 !important;border-color:#facc15 !important;color:#1a0f2e !important}';
  document.head.appendChild(style);
  function isPerformer() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function apply() {
    if (!isPerformer()) return;
    document.querySelectorAll('[data-cta]').forEach(function (a) {
      a.textContent = CONNECT_TEXT;
      a.setAttribute('href', CONNECT_HREF);
      a.classList.add('cta-yellow');
    });
  }
  // Called by the panel once it knows she has a connected room.
  window.swMarkPerformer = function () { try { localStorage.setItem(KEY, '1'); } catch (e) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
