// Researcher view: summary, filtered anonymised responses, exports, and the separate contacts list.
// The worker checks the token on every request. This page only holds the token for this browser tab.
(() => {
  'use strict';

  const API = (location.hostname === 'localhost' && localStorage.getItem('sw_api')) || 'https://streamwing-production.up.railway.app';
  const KEY = 'sw_research_admin';
  const FILTERS = [
    { param: 'audience', qid: 'Q04', label: 'Audience size' },
    { param: 'experience', qid: 'Q01', label: 'Experience' },
    { param: 'growth', qid: 'Q05', label: 'Audience growth' },
    { param: 'collab', qid: 'Q17', label: 'Collaborative experience' },
    { param: 'spend', qid: 'Q27', label: 'Spending' },
  ];

  const root = document.getElementById('admin');
  const live = document.getElementById('live');
  let survey = null;
  let byId = {};
  let futureLabels = {};
  const view = { includeTest: false, status: '', filters: {} };

  // ---- Small helpers --------------------------------------------------------

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
    return el;
  }

  function token() { try { return sessionStorage.getItem(KEY) || ''; } catch (_) { return ''; } }

  function say(msg) { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 20); }

  function explain(status, data) {
    if (status === 401) return 'That token was not accepted.';
    if (status === 503) return 'The researcher view is not set up on the server yet.';
    if (status === 429) return 'Too many requests. Wait a few minutes and try again.';
    return (data && data.error) || 'Something went wrong. Try again.';
  }

  // Calls the worker. A 401 signs out, so an old or wrong token never stays in use.
  async function api(path, opts = {}) {
    let r;
    try {
      r = await fetch(API + path, {
        method: opts.method || 'GET',
        headers: { authorization: 'Bearer ' + token(), ...(opts.body ? { 'content-type': 'application/json' } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: 'no-store',
      });
    } catch (_) {
      throw new Error('Could not reach the server. Check your connection and try again.');
    }
    if (r.status === 401) { signOut('That token was not accepted. Enter it again.'); throw new Error('unauthorised'); }
    if (!r.ok) {
      let data = {};
      try { data = await r.json(); } catch (_) { /* not JSON */ }
      throw new Error(explain(r.status, data));
    }
    return r;
  }

  function signOut(message) {
    try { sessionStorage.removeItem(KEY); } catch (_) { /* nothing to clear */ }
    showLogin(message);
  }

  function buildParams() {
    const p = new URLSearchParams();
    if (view.includeTest) p.set('include_test', '1');
    if (view.status) p.set('status', view.status);
    for (const f of FILTERS) if (view.filters[f.param]) p.set(f.param, view.filters[f.param]);
    return p;
  }

  function optionLabel(qid, v) {
    const q = byId[qid];
    const o = q && q.options && q.options.find(x => x.v === v);
    return o ? o.label : v;
  }

  // ---- Login ------------------------------------------------------------------

  function showLogin(message) {
    const input = h('input', { type: 'password', id: 'tok', autocomplete: 'off', spellcheck: 'false', required: true, 'aria-describedby': 'tok-help' });
    const err = h('p', { class: 'msg err', role: 'alert', text: message || '' });
    const form = h('form', { onsubmit: (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) { err.textContent = 'Enter the researcher access token.'; return; }
      try { sessionStorage.setItem(KEY, v); } catch (_) { /* the token stays in memory only */ }
      enter();
    } },
      h('label', { for: 'tok', text: 'Researcher access token' }),
      input,
      h('p', { id: 'tok-help', class: 'muted', text: 'The token is kept only in this browser tab and is removed when you sign out or close the tab.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Open researcher view')),
      err);
    root.replaceChildren(h('section', { class: 'panel' },
      h('h1', { tabindex: '-1', id: 'title', text: 'Research responses', style: 'font-size:26px;margin:0 0 6px' }),
      h('p', { text: 'This view is for the research team only.' }),
      form));
    document.getElementById('title').focus();
  }

  // ---- Console ----------------------------------------------------------------

  function enter() {
    if (!token()) { showLogin(); return; }
    showConsole();
  }

  function showConsole() {
    const logout = h('button', { class: 'btn ghost', type: 'button', onclick: () => signOut('You have signed out.') }, 'Sign out');
    const statsOut = h('dl', { class: 'stats', id: 'stats', 'aria-live': 'polite' });
    const dropOut = h('ul', { id: 'dropoff', class: 'muted', style: 'padding-left:18px;margin:0' });
    const filterSelects = FILTERS.map(f => {
      const sel = h('select', { id: 'f-' + f.param, 'aria-label': f.label },
        h('option', { value: '', text: 'All' }),
        ...((byId[f.qid] && byId[f.qid].options) || []).map(o => h('option', { value: o.v, text: o.label })));
      sel.value = view.filters[f.param] || '';
      return h('div', {}, h('label', { for: 'f-' + f.param, text: f.label }), sel);
    });
    const statusSel = h('select', { id: 'f-status', 'aria-label': 'Status' },
      h('option', { value: '', text: 'All' }),
      h('option', { value: 'completed', text: 'Completed' }),
      h('option', { value: 'in_progress', text: 'In progress' }));
    statusSel.value = view.status;
    const testBox = h('input', { type: 'checkbox', id: 'f-test' });
    testBox.checked = view.includeTest;

    const filterForm = h('form', { class: 'panel', id: 'filter-form', onsubmit: (e) => {
      e.preventDefault();
      view.filters = {};
      for (const f of FILTERS) { const v = document.getElementById('f-' + f.param).value; if (v) view.filters[f.param] = v; }
      view.status = statusSel.value;
      view.includeTest = testBox.checked;
      refreshResponses();
      refreshSummary();
    } },
      h('h2', { text: 'Filter responses' }),
      h('div', { class: 'filters' }, ...filterSelects,
        h('div', {}, h('label', { for: 'f-status', text: 'Status' }), statusSel)),
      h('div', { class: 'row' },
        h('label', { class: 'check' }, testBox, h('span', { text: 'Include test responses' }))),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'submit' }, 'Apply filters'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => {
          view.filters = {}; view.status = ''; view.includeTest = false;
          for (const f of FILTERS) document.getElementById('f-' + f.param).value = '';
          statusSel.value = ''; testBox.checked = false;
          refreshResponses(); refreshSummary();
        } }, 'Clear')));

    const exportBtns = h('div', { class: 'row' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => exportFile('csv') }, 'Download CSV'),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => exportFile('json') }, 'Download JSON'));
    const respMsg = h('p', { id: 'resp-msg', class: 'msg', role: 'status' });
    const respTable = h('div', { id: 'resp-table', class: 'table-wrap' });
    const contactMsg = h('p', { id: 'contact-msg', class: 'msg', role: 'status' });
    const contactTable = h('div', { id: 'contact-table', class: 'table-wrap' });

    root.replaceChildren(
      h('div', { class: 'row', style: 'justify-content:space-between' },
        h('h1', { tabindex: '-1', id: 'title', text: 'Research responses', style: 'font-size:26px;margin:0' }),
        logout),
      h('p', { class: 'muted', text: 'Anonymised. Responses hold no name, account or contact details. Contacts are listed separately below.' }),
      h('section', { class: 'panel' }, h('h2', { text: 'Summary' }), statsOut,
        h('h2', { text: 'Where people stopped', style: 'margin-top:16px' }), dropOut),
      filterForm,
      h('section', { class: 'panel' }, h('h2', { text: 'Responses' }), exportBtns, respMsg, respTable),
      h('section', { class: 'panel' }, h('h2', { text: 'Contacts (kept separately)' }),
        h('p', { text: 'Only people who gave permission appear here. Delete a contact when you no longer need it.' }),
        contactMsg, contactTable));

    document.getElementById('title').focus();
    refreshSummary();
    refreshResponses();
    refreshContacts();
  }

  // ---- Data -------------------------------------------------------------------

  async function refreshSummary() {
    const out = document.getElementById('stats');
    const drop = document.getElementById('dropoff');
    if (!out) return;
    try {
      const s = await (await api('/api/research/admin/summary?' + buildParams())).json();
      const rate = s.completionRate === null ? '-' : s.completionRate + '%';
      out.replaceChildren(
        ...[['Started', s.started], ['Completed', s.completed], ['Completion rate', rate], ['In progress', s.inProgress], ['Abandoned (2 hours or more)', s.abandoned], ['Contacts on file', s.contactsOnFile]]
          .map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: String(v) }))));
      const entries = Object.entries(s.dropOff || {}).sort((a, b) => b[1] - a[1]);
      drop.replaceChildren(...(entries.length
        ? entries.map(([k, v]) => h('li', { text: `${k === 'before first question' ? k : (byId[k] ? k + ': ' + byId[k].text : k)}: ${v}` }))
        : [h('li', { text: 'Nobody has stopped part way yet.' })]));
    } catch (e) {
      if (e.message !== 'unauthorised') out.replaceChildren(h('p', { class: 'msg err', role: 'alert', text: e.message }));
    }
  }

  async function refreshResponses() {
    const msg = document.getElementById('resp-msg');
    const box = document.getElementById('resp-table');
    if (!box) return;
    msg.textContent = 'Loading responses';
    msg.classList.remove('err');
    try {
      const data = await (await api('/api/research/admin/responses?' + buildParams())).json();
      msg.textContent = `${data.count} ${data.count === 1 ? 'response' : 'responses'} match these filters.`;
      if (!data.rows.length) { box.replaceChildren(); return; }
      const head = ['ID', 'Started', 'Status', 'Test', 'Stopped at', ...FILTERS.map(f => f.label), 'Interested in', 'All answers'];
      const rows = data.rows.map(r => {
        const cells = [
          h('td', { text: r.id.slice(0, 8) }),
          h('td', { text: new Date(r.startedAt).toLocaleString() }),
          h('td', { text: r.status === 'completed' ? 'Completed' : 'In progress' }),
          h('td', { text: r.test ? 'Yes' : 'No' }),
          h('td', { text: r.lastQuestion || '-' }),
          ...FILTERS.map(f => h('td', { text: (r.answers[f.qid] && r.answers[f.qid].display) || '' })),
          h('td', { class: 'wrapcell', text: (r.futureInterest || []).map(v => optionLabel('F01', v)).join('; ') || '-' }),
          h('td', {}, h('details', {},
            h('summary', { text: 'Show' }),
            h('dl', {}, ...Object.entries(r.answers).flatMap(([qid, a]) => [
              h('dt', { text: `${qid}. ${(byId[qid] && byId[qid].text) || ''}` }),
              h('dd', { text: a.state === 'answered' ? (a.display + (a.text ? ' (' + a.text + ')' : '')) : a.display || a.state }),
            ])))),
        ];
        return h('tr', {}, ...cells);
      });
      box.replaceChildren(h('table', {},
        h('thead', {}, h('tr', {}, ...head.map(t => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, ...rows)));
    } catch (e) {
      if (e.message !== 'unauthorised') { msg.textContent = e.message; msg.classList.add('err'); box.replaceChildren(); }
    }
  }

  async function refreshContacts() {
    const msg = document.getElementById('contact-msg');
    const box = document.getElementById('contact-table');
    if (!box) return;
    try {
      const data = await (await api('/api/research/admin/contacts')).json();
      msg.textContent = `${data.rows.length} ${data.rows.length === 1 ? 'contact' : 'contacts'} on file.`;
      msg.classList.remove('err');
      if (!data.rows.length) { box.replaceChildren(); return; }
      const rows = data.rows.map(c => {
        const actions = h('td', {});
        const showDelete = () => actions.replaceChildren(
          h('button', { class: 'btn ghost', type: 'button', onclick: () => showConfirm() }, 'Delete'));
        const showConfirm = () => actions.replaceChildren(
          h('button', { class: 'btn', type: 'button', onclick: () => deleteContact(c.id) }, 'Confirm delete'),
          ' ',
          h('button', { class: 'btn ghost', type: 'button', onclick: showDelete }, 'Cancel'));
        showDelete();
        return h('tr', {},
          h('td', { text: c.preferred_name || '-' }),
          h('td', { text: c.contact_method === 'email' ? 'Email' : 'Other' }),
          h('td', { class: 'wrapcell', text: c.contact_value }),
          h('td', { text: c.timezone || '-' }),
          h('td', { class: 'wrapcell', text: (c.activities || []).map(v => optionLabel('F01', v)).join('; ') || '-' }),
          h('td', { text: new Date(c.created_at).toLocaleDateString() }),
          actions);
      });
      box.replaceChildren(h('table', {},
        h('thead', {}, h('tr', {}, ...['Name', 'Method', 'Contact', 'Time zone', 'Activities', 'Added', ''].map(t => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, ...rows)));
    } catch (e) {
      if (e.message !== 'unauthorised') { msg.textContent = e.message; msg.classList.add('err'); box.replaceChildren(); }
    }
  }

  async function deleteContact(id) {
    const msg = document.getElementById('contact-msg');
    try {
      await api('/api/research/admin/contacts/delete', { method: 'POST', body: { id } });
      say('Contact deleted.');
      refreshContacts();
      refreshSummary();
    } catch (e) {
      if (e.message !== 'unauthorised') { msg.textContent = e.message; msg.classList.add('err'); }
    }
  }

  // The export needs the token header, so it is fetched and saved as a file here.
  async function exportFile(format) {
    const msg = document.getElementById('resp-msg');
    const p = buildParams();
    p.set('format', format);
    try {
      const r = await api('/api/research/admin/export?' + p);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: format === 'json' ? 'research-responses.json' : 'research-responses.csv' });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      msg.textContent = `Downloaded ${format.toUpperCase()}.`;
      msg.classList.remove('err');
    } catch (e) {
      if (e.message !== 'unauthorised') { msg.textContent = e.message; msg.classList.add('err'); }
    }
  }

  // ---- Start ------------------------------------------------------------------

  async function load() {
    try {
      const r = await fetch(API + '/api/research/survey');
      if (!r.ok) throw new Error('bad status');
      survey = await r.json();
    } catch (_) {
      root.replaceChildren(h('section', { class: 'panel' },
        h('h1', { tabindex: '-1', id: 'title', text: 'The survey definition could not be loaded', style: 'font-size:24px' }),
        h('p', { text: 'Try again in a few minutes.' })));
      return;
    }
    byId = Object.fromEntries(survey.questions.map(q => [q.id, q]));
    enter();
  }

  load();
})();
