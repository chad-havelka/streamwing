// Main call to action.
// A visitor who has opened StreamWing on this device with a connected room already has it.
// For her, the main button on every page opens StreamWing, in the connected colour (a theme token),
// and the quiet "Open StreamWing" link in the header steps aside so the header does not say it twice.
// The flag lives only in this browser (localStorage). Nothing is sent anywhere.
(function () {
  var KEY = 'sw_performer';
  var OPEN_TEXT = 'Open StreamWing';
  var OPEN_HREF = '/owl/';
  function isPerformer() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  function apply() {
    if (!isPerformer()) return;
    document.querySelectorAll('[data-cta]').forEach(function (a) {
      a.textContent = OPEN_TEXT;
      a.setAttribute('href', OPEN_HREF);
      a.classList.add('cta-performer');
    });
    document.querySelectorAll('[data-open]').forEach(function (a) { a.hidden = true; });
  }
  // Called by StreamWing once it knows she has a connected room.
  window.swMarkPerformer = function () { try { localStorage.setItem(KEY, '1'); } catch (e) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
