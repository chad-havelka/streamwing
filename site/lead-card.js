/* Early-access card on the privacy and terms pages. The card's button opens a modal with the full form.
   The form posts to the same Netlify form as the home page. */
(() => {
  const form = document.getElementById('lcForm');
  const modal = document.getElementById('lcModal');
  const openBtn = document.getElementById('lcOpen');
  if (!form || !modal || !openBtn) return;
  const $ = id => document.getElementById(id);
  const msg = $('lcMsg');
  const REACH = {
    Email: ['Email address', 'you@example.com'],
    Telegram: ['Telegram username', '@yourname'],
    WhatsApp: ['WhatsApp number, with country code', '+1 312 555 0100']
  };
  const reachVia = () => document.querySelector('input[name="lcVia"]:checked').value;
  const setMsg = (t, err) => { msg.textContent = t; msg.className = 'msg' + (err ? ' err' : ''); };
  const newId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  const ref = (() => {
    try {
      const q = new URLSearchParams(location.search).get('ref');
      if (q) { const c = q.replace(/[^\w-]/g, '').slice(0, 40); if (c) { localStorage.setItem('sw_ref', c); return c; } }
      return localStorage.getItem('sw_ref') || '';
    } catch (e) { return ''; }
  })();

  /* Modal: opens from the card, closes on the × button, Escape or a click outside the panel. */
  let lastTrigger = null;
  const openModal = () => {
    lastTrigger = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('lc-open');
    $('lcName').focus();
  };
  const closeModal = () => {
    modal.hidden = true;
    document.body.classList.remove('lc-open');
    if (lastTrigger && lastTrigger.focus) lastTrigger.focus();
  };
  openBtn.addEventListener('click', openModal);
  $('lcClose').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  form.addEventListener('change', e => {
    if (e.target.name === 'lcVia') {
      const v = reachVia();
      $('lcLabel').textContent = REACH[v][0];
      $('lcVal').placeholder = REACH[v][1];
      $('lcWaWrap').hidden = v !== 'WhatsApp';
      $('lcVal').value = '';
    }
    if (e.target.closest && e.target.closest('#lcChips')) {
      const other = document.querySelector('#lcChips input[value="Other"]');
      $('lcOtherWrap').hidden = !other.checked;
      if (!other.checked) $('lcOther').value = '';
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('lcName').value.trim();
    const picked = [...document.querySelectorAll('#lcChips input:checked')].map(x => x.value);
    const other = $('lcOther').value.trim();
    const via = reachVia(), reach = $('lcVal').value.trim(), waOk = $('lcWa').checked;
    if (!name) { setMsg('Add your streamer name.', true); $('lcName').focus(); return; }
    if (!picked.length) { setMsg('Pick at least one platform.', true); return; }
    if (picked.includes('Other') && !other) { setMsg('Name the other platform.', true); $('lcOther').focus(); return; }
    if (!reach) { setMsg('Add your ' + REACH[via][0].toLowerCase().split(',')[0] + '.', true); $('lcVal').focus(); return; }
    if (via === 'Email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reach)) { setMsg('That email address looks incomplete.', true); $('lcVal').focus(); return; }
    if (via === 'WhatsApp' && reach.replace(/\D/g, '').length < 8) { setMsg('Add your full WhatsApp number, with country code.', true); $('lcVal').focus(); return; }
    if (via === 'WhatsApp' && !waOk) { setMsg('Tick the box so we can message you on WhatsApp, or choose another way to reach you.', true); return; }

    const id = newId();
    const platforms = picked.map(p => p === 'Other' ? 'Other: ' + other : p).join(', ');
    const body = new URLSearchParams({
      'form-name': 'early-access',
      'lead-id': id,
      'streamer-name': name,
      platforms,
      'reach-via': via,
      reach,
      'whatsapp-optin': via === 'WhatsApp' && waOk ? 'yes' : 'no',
      'referral-code': ref
    });
    const btn = $('lcBtn');
    btn.disabled = true;
    setMsg('Saving…');
    try {
      const r = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      if (!r.ok) throw new Error(r.status);
      try { localStorage.setItem('sw_mycode', id.replace(/-/g, '').slice(0, 8)); } catch (err) {}
      setMsg('');
      form.hidden = true;
      $('lcDone').textContent = "You're on the list, " + name + '. We’ll reach you on ' + via.toLowerCase() + '.';
      $('lcDone').hidden = false;
    } catch (err) {
      setMsg("That didn't save. Try again.", true);
      btn.disabled = false;
    }
  });
})();
