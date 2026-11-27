// The performer research survey. The questions come from the worker, so the page and the
// server always agree. The branch rules below mirror worker/src/research-survey.js.
(() => {
  'use strict';

  const API = (location.hostname === 'localhost' && localStorage.getItem('sw_api')) || 'https://streamwing-production.up.railway.app';
  const STORE = 'sw_research';
  const params = new URLSearchParams(location.search);
  const TEST = params.get('test') === '1';
  const SRC = params.get('src');
  const SOURCE = SRC && /^[a-z0-9_-]{1,40}$/.test(SRC) ? SRC : undefined;

  const root = document.getElementById('survey');
  const live = document.getElementById('live');

  let survey = null;   // { version, sections, questions }
  let byId = {};
  let research = [];   // questions a participant answers, in order (F01 excluded)
  let session = null;  // { id, version }
  let answers = {};    // id -> record
  let index = 0;       // position in currentList()
  let orders = {};     // id -> shuffled option order, so Back shows the same order
  let completed = false;
  let busy = false;

  const REQUIRED = {
    text: 'Please write an answer to continue.',
    single: 'Choose one option to continue.',
    multi: 'Choose at least one option to continue.',
    multi_text: 'Please answer to continue.',
  };

  // ---- Branch rules, mirrored from the worker ------------------------------

  function holds(cond, a) {
    if (cond.anyOf) return cond.anyOf.some(c => holds(c, a));
    if (cond.allOf) return cond.allOf.every(c => holds(c, a));
    const x = a[cond.q];
    if (!x || x.state !== 'answered') return false;
    if (cond.answered) return true;
    if (cond.mode) return x.mode === cond.mode;
    if (cond.in) return Array.isArray(x.values) ? x.values.some(v => cond.in.includes(v)) : cond.in.includes(x.value);
    if (cond.notIn) return !cond.notIn.includes(x.value);
    return false;
  }

  function applicable(a) {
    return research.filter(q => !q.showIf || holds(q.showIf, a));
  }

  function currentList() {
    return applicable(answers);
  }

  // Removes answers that no longer apply. Repeats, because one removal can remove another condition.
  function prune(a) {
    let cur = { ...a };
    for (;;) {
      const ok = new Set(applicable(cur).map(q => q.id));
      const next = {};
      for (const [k, rec] of Object.entries(cur)) if (ok.has(k)) next[k] = rec;
      if (Object.keys(next).length === Object.keys(cur).length) return next;
      cur = next;
    }
  }

  // ---- DOM helpers ------------------------------------------------------------

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

  function noticeEl() {
    return h('div', { class: 'notice', id: 'notice', role: 'alert', hidden: true });
  }

  function notice(msg) {
    const box = root.querySelector('#notice');
    if (box) { box.textContent = msg; box.hidden = false; } else say(msg);
  }

  function clearNotice() {
    const box = root.querySelector('#notice');
    if (box) { box.hidden = true; box.textContent = ''; }
  }

  function say(msg) {
    live.textContent = '';
    setTimeout(() => { live.textContent = msg; }, 20);
  }

  function shell(content, progress) {
    const parts = [];
    if (TEST) parts.push(h('p', { class: 'test-banner', role: 'note', text: 'Test response. These answers are kept apart from research results.' }));
    if (progress) {
      const pct = Math.round((progress.pos / progress.total) * 100);
      parts.push(h('div', { class: 'progress' },
        h('p', { class: 'progress-label', text: `Question ${progress.pos} of ${progress.total}` }),
        h('div', { class: 'progress-bar', role: 'progressbar', 'aria-label': 'Survey progress', 'aria-valuemin': '0', 'aria-valuemax': String(progress.total), 'aria-valuenow': String(progress.pos) },
          h('span', { style: `width:${pct}%` }))));
    }
    parts.push(content);
    root.replaceChildren(...parts);
    const first = root.querySelector('[data-focus]');
    if (first) first.focus();
  }

  // ---- Storage (sessionStorage only, so answers survive a reload in the same tab) ----

  function save() {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ session, answers, index, orders, completed }));
    } catch (_) { /* storage blocked: answers stay in memory for this visit */ }
  }

  function restore() {
    try {
      const raw = sessionStorage.getItem(STORE);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s.session || !s.session.id) return false;
      session = s.session;
      answers = s.answers || {};
      index = s.index || 0;
      orders = s.orders || {};
      completed = !!s.completed;
      return true;
    } catch (_) { return false; }
  }

  function clearSaved() {
    try { sessionStorage.removeItem(STORE); } catch (_) { /* nothing to clear */ }
  }

  // ---- Network ----------------------------------------------------------------

  async function post(path, body) {
    const r = await fetch(API + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await r.json(); } catch (_) { /* empty or non-JSON body */ }
    return { ok: r.ok, status: r.status, data };
  }

  // Sends the answers so far. Resolves to one of: { ok }, { rejected, message }, { expired }, { offline }.
  async function reportProgress(lastQuestion) {
    if (!session) return { ok: true };
    try {
      const r = await post('/api/research/progress', { id: session.id, answers, lastQuestion });
      if (r.status === 404) return { expired: true };
      if (!r.ok) return { rejected: true, message: r.data.error || 'We could not save that answer. Check it and try again.' };
      return { ok: true };
    } catch (_) {
      return { offline: true };
    }
  }

  // ---- Option order ------------------------------------------------------------

  // Shuffles free options. Anchored options ("Other", "I don't know", "Not applicable") stay last.
  function ordered(q) {
    if (!q.shuffle) return q.options;
    if (!orders[q.id]) {
      const free = q.options.filter(o => !o.anchor).map(o => o.v);
      for (let i = free.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [free[i], free[j]] = [free[j], free[i]];
      }
      orders[q.id] = [...free, ...q.options.filter(o => o.anchor).map(o => o.v)];
    }
    return orders[q.id].map(v => q.options.find(o => o.v === v));
  }

  // ---- Introduction and exit ---------------------------------------------------

  function intro() {
    const age = h('input', { type: 'checkbox', id: 'ck-age' });
    const perf = h('input', { type: 'checkbox', id: 'ck-perf' });
    const agree = h('input', { type: 'checkbox', id: 'ck-agree' });

    const startBtn = h('button', { class: 'btn', type: 'button', id: 'startBtn', onclick: () => {
      clearNotice();
      if (!(age.checked && perf.checked && agree.checked)) {
        notice('Please tick all three statements to start. If you cannot confirm them, you are not eligible for this survey.');
        return;
      }
      beginSurvey();
    } }, 'Start the survey');

    const notEligible = h('button', { class: 'btn ghost', type: 'button', onclick: exitScreen }, 'I cannot confirm these');

    shell(h('section', { class: 'card' },
      h('p', { class: 'kicker', text: 'Research' }),
      h('h1', { tabindex: '-1', 'data-focus': true, text: 'What Would Make Camming Better for You?' }),
      h('p', { text: 'We are researching the experiences, challenges and goals of Chaturbate performers. We want to understand what works, what does not, and what you wish was possible.' }),
      h('p', { text: 'Taking part is voluntary. You can skip optional questions or leave at any time. Please do not include legal names, private customer information, account passwords or intimate content.' }),
      h('p', { text: 'StreamWing (streamwing.studio) is conducting this research. We use the answers to decide what StreamWing builds, and we share combined findings. We will not publish anything that identifies you.' }),
      h('p', { text: 'Your answers are not linked to your name, account or contact details. You can leave contact details at the end, or skip that step. Unfinished answers are deleted after 30 days. Completed answers are kept for 24 months. Contact details are kept for up to 12 months, or until you ask us to delete them.' }),
      h('fieldset', { class: 'confirm' },
        h('legend', { class: 'sr-only', text: 'Before you begin, please confirm each statement' }),
        checkRow(age, 'I am at least 18 years old.'),
        checkRow(perf, 'I currently perform, or have previously performed, on Chaturbate.'),
        checkRow(agree, 'I understand the purpose of this research and voluntarily agree to take part.')),
      noticeEl(),
      h('div', { class: 'actions' }, notEligible, startBtn)), null);
  }

  function checkRow(input, label) {
    return h('label', { class: 'check-row' }, input, h('span', { text: label }));
  }

  function exitScreen() {
    shell(h('section', { class: 'card' },
      h('h1', { tabindex: '-1', 'data-focus': true, text: 'Thank you for your interest' }),
      h('p', { text: 'This survey is for adults who currently perform, or have previously performed, on Chaturbate. We are sorry we cannot include you this time.' })), null);
  }

  // ---- Survey flow -------------------------------------------------------------

  async function beginSurvey() {
    if (busy) return;
    busy = true;
    const btn = root.querySelector('#startBtn');
    if (btn) btn.disabled = true;
    clearNotice();
    try {
      const r = await post('/api/research/start', {
        consent: { age: true, performer: true, agree: true },
        test: TEST,
        source: SOURCE,
      });
      if (!r.ok) throw new Error(r.data.error || 'We could not start the survey.');
      session = { id: r.data.id, version: r.data.version };
      answers = {};
      index = 0;
      orders = {};
      completed = false;
      save();
      showQuestion();
    } catch (e) {
      if (btn) btn.disabled = false;
      notice(e instanceof TypeError ? 'We could not reach the server. Check your connection and try again.' : e.message);
    } finally {
      busy = false;
    }
  }

  function showQuestion() {
    const list = currentList();
    if (!list.length) { submitAll(); return; }
    if (index >= list.length) index = list.length - 1;
    if (index < 0) index = 0;
    const q = list[index];
    const pos = index + 1;
    const total = list.length;

    const inactive = q.textInactive && answers.Q02 && answers.Q02.value === 'not_at_all';
    const text = inactive ? q.textInactive : q.text;

    const back = index > 0
      ? h('button', { class: 'btn ghost', type: 'button', onclick: goBack }, 'Back')
      : h('span', {});
    const next = h('button', { class: 'btn', type: 'button', id: 'next', onclick: goNext },
      pos === total ? 'Submit' : 'Continue');

    shell(h('section', { class: 'card' },
      h('p', { class: 'kicker', text: survey.sections[q.section] }),
      renderInput(q, text),
      noticeEl(),
      h('div', { class: 'actions' }, back, next)),
    { pos, total });

    save();
  }

  // Builds the input for one question. Every change writes the answer straight into `answers`.
  function renderInput(q, text) {
    const rec = answers[q.id] || {};
    const head = [
      h('h1', { id: 'qtext', tabindex: '-1', 'data-focus': true, class: 'qtext', text }),
      q.optional ? h('p', { class: 'optional', text: 'Optional. You can skip this question.' }) : null,
      q.help ? h('p', { class: 'help', text: q.help }) : null,
    ];

    if (q.type === 'text') {
      const ta = h('textarea', { id: 'answer', rows: '6', maxlength: '2000', 'aria-labelledby': 'qtext' });
      ta.value = rec.text || '';
      ta.addEventListener('input', () => {
        answers[q.id] = ta.value.trim() ? { state: 'answered', text: ta.value } : { state: 'unanswered' };
      });
      return h('div', {}, ...head, h('div', { class: 'field' }, ta));
    }

    if (q.type === 'text_or_none') {
      const ta = h('textarea', { id: 'answer', rows: '6', maxlength: '2000', 'aria-labelledby': 'qtext' });
      const none = h('input', { type: 'checkbox', id: 'none' });
      none.checked = rec.mode === 'none';
      ta.value = rec.mode === 'text' ? (rec.text || '') : '';
      ta.disabled = none.checked;

      const sync = () => {
        if (none.checked) {
          ta.value = '';
          ta.disabled = true;
          answers[q.id] = { state: 'answered', mode: 'none' };
          return;
        }
        ta.disabled = false;
        answers[q.id] = ta.value.trim() ? { state: 'answered', mode: 'text', text: ta.value } : { state: 'unanswered' };
      };
      ta.addEventListener('input', () => {
        if (ta.value.trim()) none.checked = false;
        sync();
      });
      none.addEventListener('change', () => {
        sync();
        if (!none.checked) ta.focus();
      });
      sync();
      return h('div', {}, ...head,
        h('div', { class: 'field' }, ta),
        h('label', { class: 'option' }, none, h('span', { text: q.noneLabel })));
    }

    // single, multi and multi_text: option lists, with an optional free-text box for Other.
    const multi = q.type !== 'single';
    const opts = ordered(q);
    const current = new Set(rec.values || (rec.value ? [rec.value] : []));
    const inputs = [];
    const otherBoxes = {};

    const rows = opts.map(o => {
      const input = h('input', { type: multi ? 'checkbox' : 'radio', name: 'choice', value: o.v });
      input.checked = current.has(o.v);
      inputs.push({ o, input });
      const label = h('label', { class: 'option' }, input, h('span', { text: o.label }));
      if (!o.other) return h('div', { class: 'option-group' }, label);
      const box = h('input', { type: 'text', class: 'other-text', maxlength: '300', placeholder: 'Please specify', 'aria-label': `${o.label}: please specify` });
      box.value = rec.text || '';
      box.hidden = !input.checked;
      box.addEventListener('input', sync);
      otherBoxes[o.v] = box;
      return h('div', { class: 'option-group' }, label, box);
    });

    let ta = null;
    if (q.type === 'multi_text') {
      const hasOther = opts.some(o => o.other);
      ta = h('textarea', { id: 'answer', rows: '4', maxlength: '2000', 'aria-label': 'Anything else, in your own words (optional)' });
      ta.value = hasOther ? '' : (rec.text || '');
      ta.addEventListener('input', sync);
    }

    // Reads every control for this question and writes one answer record.
    function sync() {
      const chosen = inputs.filter(x => x.input.checked);
      for (const x of inputs) if (otherBoxes[x.o.v]) otherBoxes[x.o.v].hidden = !x.input.checked;
      const values = chosen.map(x => x.o.v);
      const other = chosen.find(x => x.o.other);
      const rec2 = {};
      if (multi) rec2.values = values;
      else if (values.length) rec2.value = values[0];
      if (other) rec2.text = otherBoxes[other.o.v].value;
      if (ta && ta.value.trim()) rec2.text = ta.value;
      const has = values.length > 0 || (ta && ta.value.trim() !== '');
      answers[q.id] = (has || other) ? { state: 'answered', ...rec2 } : { state: 'unanswered' };
      save();
    }

    for (const { o, input } of inputs) {
      input.addEventListener('change', () => {
        if (multi && input.checked) {
          // An exclusive choice clears the rest. Choosing anything else clears exclusive choices.
          for (const other of inputs) {
            if (other.input !== input && (o.exclusive || other.o.exclusive)) other.input.checked = false;
          }
        }
        sync();
      });
    }

    sync();
    const group = h('fieldset', { class: 'choices', 'aria-labelledby': 'qtext' }, ...rows);
    return h('div', {}, ...head, group, ta ? h('div', { class: 'field' }, ta) : null);
  }

  // Returns the message to show, or null when the question can move on.
  // Optional questions that are not answered are recorded as skipped.
  function check(q) {
    const rec = answers[q.id] || {};
    const has = rec.state === 'answered';
    const txt = ((rec.text) || '').trim();
    const vals = rec.values || (rec.value ? [rec.value] : []);
    const other = (q.options || []).find(o => o.other);

    if (has && other && vals.includes(other.v) && !txt) return 'Please say what you mean in the Other box.';

    let ok = false;
    if (q.type === 'text') ok = has && txt !== '';
    else if (q.type === 'text_or_none') ok = has && (rec.mode === 'none' || (rec.mode === 'text' && txt !== ''));
    else if (q.type === 'single' || q.type === 'multi') ok = has && vals.length > 0;
    else ok = has && (vals.length > 0 || txt !== '');
    if (ok) return null;

    if (q.optional) { answers[q.id] = { state: 'skipped' }; return null; }
    if (q.type === 'text_or_none') return `Write an answer, or tick "${q.noneLabel}".`;
    return REQUIRED[q.type] || 'Please answer to continue.';
  }

  async function goNext() {
    if (busy) return;
    clearNotice();
    const list = currentList();
    const q = list[index];
    if (!q) return;

    const problem = check(q);
    if (problem) { notice(problem); return; }

    answers = prune(answers);
    save();

    busy = true;
    const btn = root.querySelector('#next');
    if (btn) btn.disabled = true;
    try {
      const res = await reportProgress(q.id);
      if (res.rejected) { notice(res.message); return; }
      if (res.expired) { restart('This survey session has ended. Your answers were not saved. Please start again.'); return; }
      if (res.offline) say('We could not reach the server. Your answers are kept on this device.');

      const after = currentList();
      const here = after.findIndex(x => x.id === q.id);
      if (here < 0 || here + 1 >= after.length) { await submitAll(); return; }
      index = here + 1;
      showQuestion();
    } finally {
      busy = false;
      if (btn && btn.isConnected) btn.disabled = false;
    }
  }

  function goBack() {
    if (index > 0) index -= 1;
    showQuestion();
  }

  async function submitAll() {
    const btn = root.querySelector('#next');
    if (btn) btn.disabled = true;
    try {
      const r = await post('/api/research/submit', { id: session.id, answers: prune(answers) });
      if (r.status === 404) { restart('This survey session has ended. Please start again.'); return; }
      if (!r.ok) throw new Error(r.data.error || 'We could not submit your answers.');
      completed = true;
      save();
      thanks();
    } catch (e) {
      if (btn) btn.disabled = false;
      const msg = e instanceof TypeError ? 'We could not reach the server.' : e.message;
      notice(`${msg} Your answers are still here. Try again.`);
    }
  }

  function thanks() {
    shell(h('section', { class: 'card' },
      h('h1', { tabindex: '-1', 'data-focus': true, text: 'Thank you' }),
      h('p', { text: 'Your answers have been saved.' }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: askInterest }, 'Continue'))), null);
  }

  // Optional question about future research. Skipping is fine.
  function askInterest() {
    const f = byId.F01;
    const boxes = f.options.map(o => ({ o, input: h('input', { type: 'checkbox', value: o.v }) }));
    for (const { o, input } of boxes) {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        for (const x of boxes) if (x.input !== input && (o.exclusive || x.o.exclusive)) x.input.checked = false;
      });
    }

    const picked = () => boxes.filter(x => x.input.checked).map(x => x.input.value);
    shell(h('section', { class: 'card' },
      h('h1', { tabindex: '-1', 'data-focus': true, class: 'qtext', text: f.text }),
      h('p', { class: 'optional', text: 'Optional. You can skip this question.' }),
      h('fieldset', { class: 'choices', 'aria-labelledby': 'qtext' },
        ...boxes.map(x => h('div', { class: 'option-group' }, h('label', { class: 'option' }, x.input, h('span', { text: x.o.label }))))),
      noticeEl(),
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', type: 'button', onclick: done }, 'Skip'),
        h('button', { class: 'btn', type: 'button', onclick: () => sendInterest(picked()) }, 'Continue'))), null);
  }

  async function sendInterest(list) {
    const wanted = list.filter(v => v !== 'no_thanks');
    if (list.length && session) {
      try { await post('/api/research/interest', { id: session.id, interest: list }); } catch (_) { /* optional; carry on */ }
    }
    if (!wanted.length) { done(); return; }
    contactScreen(wanted);
  }

  // Contact details are a separate, optional step. They are not sent with the responses.
  function contactScreen(wanted) {
    const labelFor = v => (byId.F01.options.find(o => o.v === v) || {}).label || v;
    const name = h('input', { type: 'text', id: 'c-name', maxlength: '100', autocomplete: 'off' });
    const method = h('select', { id: 'c-method' },
      h('option', { value: 'email', text: 'Email' }),
      h('option', { value: 'other', text: 'Another handle or app' }));
    const value = h('input', { type: 'text', id: 'c-value', maxlength: '200', autocomplete: 'off', 'aria-describedby': 'c-value-help' });
    const tz = h('input', { type: 'text', id: 'c-tz', maxlength: '60', placeholder: 'For example, Central Time' });
    const perm = h('input', { type: 'checkbox', id: 'c-perm' });
    const msg = h('p', { class: 'help', role: 'status' });

    async function saveDetails() {
      msg.textContent = '';
      if (!perm.checked) { msg.textContent = 'Tick the box to give permission, or skip this step.'; return; }
      if (!value.value.trim()) { msg.textContent = 'Enter a contact address or handle, or skip this step.'; return; }
      try {
        const r = await post('/api/research/contact', {
          preferredName: name.value,
          method: method.value,
          value: value.value,
          timezone: tz.value,
          permission: true,
          activities: wanted,
        });
        if (!r.ok) { msg.textContent = r.data.error || 'We could not save your details.'; return; }
        done();
      } catch (_) {
        msg.textContent = 'We could not reach the server. Check your connection, or skip this step.';
      }
    }

    shell(h('section', { class: 'card' },
      h('h1', { tabindex: '-1', 'data-focus': true, text: 'Stay in touch (optional)' }),
      h('p', { text: `You said you are interested in: ${wanted.map(labelFor).join(', ')}.` }),
      h('p', { text: 'Your contact details are stored separately from your answers and are not linked to them.' }),
      h('div', { class: 'field' }, h('label', { for: 'c-name', text: 'Preferred name or alias (optional)' }), name),
      h('div', { class: 'field' }, h('label', { for: 'c-method', text: 'Preferred contact method' }), method),
      h('div', { class: 'field' },
        h('label', { for: 'c-value', text: 'Email address or handle' }),
        value,
        h('p', { id: 'c-value-help', class: 'help', text: 'Please do not give a legal name or a Chaturbate username.' })),
      h('div', { class: 'field' }, h('label', { for: 'c-tz', text: 'Time zone (optional)' }), tz),
      checkRow(perm, 'I give permission to contact me about the activities I chose.'),
      msg,
      h('div', { class: 'actions' },
        h('button', { class: 'btn ghost', type: 'button', onclick: done }, 'Skip'),
        h('button', { class: 'btn', type: 'button', onclick: saveDetails }, 'Save my details'))), null);
  }

  function done() {
    clearSaved();
    shell(h('section', { class: 'card' },
      h('h1', { tabindex: '-1', 'data-focus': true, text: 'All done' }),
      h('p', { text: 'Thank you for taking part.' })), null);
  }

  function restart(message) {
    clearSaved();
    session = null;
    answers = {};
    index = 0;
    orders = {};
    completed = false;
    intro();
    notice(message);
  }

  // ---- Start ------------------------------------------------------------------

  async function load() {
    try {
      const r = await fetch(API + '/api/research/survey');
      if (!r.ok) throw new Error('bad status');
      survey = await r.json();
    } catch (_) {
      shell(h('section', { class: 'card' },
        h('h1', { tabindex: '-1', 'data-focus': true, text: 'The survey is not available right now' }),
        h('p', { text: 'Please try again in a few minutes.' })), null);
      return;
    }
    byId = Object.fromEntries(survey.questions.map(q => [q.id, q]));
    research = survey.questions.filter(q => q.id !== 'F01');

    if (restore() && session) {
      if (completed) { thanks(); return; }
      if (session.version !== survey.version) { restart('The survey has changed since you started. Please start again.'); return; }
      showQuestion();
      return;
    }
    intro();
  }

  load();
})();
