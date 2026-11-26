// Performer research: the questionnaire API and the researcher-only view.
// Public routes take no account. Researcher routes need RESEARCH_ADMIN_TOKEN.
import crypto from 'node:crypto';
import { q } from './db.js';
import { config } from './config.js';
import {
  SURVEY_VERSION, QUESTION_BY_ID, RESEARCH_QUESTIONS, publicSurvey,
  checkResponse, normalise, cleanText,
} from './research-survey.js';

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

// Survey answers are larger than the panel's requests, so this reader allows more.
const MAX_BODY = 250_000;
async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw Object.assign(new Error('Too much data'), { status: 413 });
  }
  try { return body ? JSON.parse(body) : {}; } catch { throw Object.assign(new Error('Bad request'), { status: 400 }); }
}

// Limits per IP address, held in memory only. Nothing about the address is stored.
const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = { start: 20, progress: 600, submit: 30, contact: 10, admin: 300 };
const hits = new Map();
function allowed(kind, ip) {
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= LIMITS[kind]) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

// Future participation choices. Stored with the response as a count of choices, never as identity.
const INTEREST_OPTIONS = QUESTION_BY_ID.F01.options.map(o => o.v);
function interestOf(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) return null;
  if (list.some(v => !INTEREST_OPTIONS.includes(v))) return null;
  if (new Set(list).size !== list.length) return null;
  if (list.includes('no_thanks') && list.length > 1) return null;
  return list;
}

const isUuid = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const SOURCE = /^[a-z0-9_-]{1,40}$/;

// The public half of the API. Returns true when it handled the request.
export async function handleResearchPublic(req, res, url, path) {
  const ip = req.socket.remoteAddress || 'unknown';

  if (req.method === 'GET' && path === '/api/research/survey') {
    send(res, 200, publicSurvey());
    return true;
  }

  if (req.method === 'POST' && path === '/api/research/start') {
    if (!allowed('start', ip)) { send(res, 429, { error: 'Too many attempts. Try again in a few minutes.' }); return true; }
    const { consent, test, source } = await readJson(req);
    const c = consent || {};
    if (c.age !== true || c.performer !== true || c.agree !== true) {
      send(res, 400, { error: 'All three confirmations are needed to take part.' });
      return true;
    }
    const id = crypto.randomUUID();
    const src = typeof source === 'string' && SOURCE.test(source) ? source : null;
    await q(
      `insert into research_responses (id, survey_version, status, test, consent_at, source)
       values ($1, $2, 'in_progress', $3, now(), $4)`,
      [id, SURVEY_VERSION, test === true, src]);
    send(res, 200, { id, version: SURVEY_VERSION });
    return true;
  }

  if (req.method === 'POST' && path === '/api/research/progress') {
    if (!allowed('progress', ip)) { send(res, 429, { error: 'Too many requests. Try again shortly.' }); return true; }
    const { id, answers, lastQuestion } = await readJson(req);
    if (!isUuid(id)) { send(res, 400, { error: 'This survey session is not valid. Start again.' }); return true; }
    const err = checkResponse(answers, 'progress');
    if (err) { send(res, 400, { error: err }); return true; }
    const last = QUESTION_BY_ID[lastQuestion] ? lastQuestion : null;
    const r = await q(
      `update research_responses set answers=$2, last_question=$3, updated_at=now()
       where id=$1 and status='in_progress'`,
      [id, JSON.stringify(normalise(answers)), last]);
    if (r.rowCount === 0) { send(res, 404, { error: 'This survey session was not found or is already finished.' }); return true; }
    send(res, 200, { ok: true });
    return true;
  }

  // Future participation choices, asked after the response is submitted. Stored on that response.
  if (req.method === 'POST' && path === '/api/research/interest') {
    if (!allowed('progress', ip)) { send(res, 429, { error: 'Too many requests. Try again shortly.' }); return true; }
    const { id, interest } = await readJson(req);
    if (!isUuid(id)) { send(res, 400, { error: 'This survey session is not valid.' }); return true; }
    const list = interestOf(interest);
    if (list === null) { send(res, 400, { error: 'Choose from the options.' }); return true; }
    const r = await q(
      `update research_responses set future_interest=$2, updated_at=now() where id=$1 and status='completed'`,
      [id, JSON.stringify(list)]);
    if (r.rowCount === 0) { send(res, 404, { error: 'This survey session was not found.' }); return true; }
    send(res, 200, { ok: true });
    return true;
  }

  if (req.method === 'POST' && path === '/api/research/submit') {
    if (!allowed('submit', ip)) { send(res, 429, { error: 'Too many requests. Try again shortly.' }); return true; }
    const { id, answers, interest } = await readJson(req);
    if (!isUuid(id)) { send(res, 400, { error: 'This survey session is not valid. Start again.' }); return true; }
    const err = checkResponse(answers, 'submit');
    if (err) { send(res, 400, { error: err }); return true; }
    const future = interestOf(interest);
    if (future === null) { send(res, 400, { error: 'Choose from the options.' }); return true; }
    const r = await q(
      `update research_responses set status='completed', answers=$2, future_interest=$3, completed_at=now(), updated_at=now(), last_question=null
       where id=$1 and status in ('in_progress')`,
      [id, JSON.stringify(normalise(answers)), JSON.stringify(future)]);
    if (r.rowCount === 0) {
      const already = await q(`select status from research_responses where id=$1`, [id]);
      if (already.rows[0]?.status === 'completed') { send(res, 200, { ok: true }); return true; }
      send(res, 404, { error: 'This survey session was not found.' });
      return true;
    }
    send(res, 200, { ok: true });
    return true;
  }

  // Voluntary contact details. Stored in their own table, with no link to any response.
  if (req.method === 'POST' && path === '/api/research/contact') {
    if (!allowed('contact', ip)) { send(res, 429, { error: 'Too many requests. Try again shortly.' }); return true; }
    const body = await readJson(req);
    if (body.permission !== true) { send(res, 400, { error: 'Permission to contact you is needed.' }); return true; }
    const method = body.method === 'email' ? 'email' : 'other';
    const value = cleanText(body.value || '');
    if (!value || value.length > 200) { send(res, 400, { error: 'Enter a contact address or handle (200 characters or fewer).' }); return true; }
    if (method === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { send(res, 400, { error: 'That email address does not look right.' }); return true; }
    const name = cleanText(body.preferredName || '').slice(0, 100) || null;
    const tz = cleanText(body.timezone || '').slice(0, 60) || null;
    const allowedActivities = ['anonymous_surveys', 'text_conversations', 'video_conversations', 'group_discussions', 'experimental_tools', 'local_events'];
    const activities = Array.isArray(body.activities) ? body.activities.filter(a => allowedActivities.includes(a)) : [];
    await q(
      `insert into research_contacts (preferred_name, contact_method, contact_value, timezone, activities)
       values ($1, $2, $3, $4, $5)`,
      [name, method, value, tz, JSON.stringify(activities)]);
    send(res, 200, { ok: true });
    return true;
  }

  return false;
}

// ---- Researcher view ------------------------------------------------------

function adminOk(req) {
  const expected = config.researchAdminToken;
  if (!expected) return 'unset';
  const h = req.headers.authorization || '';
  const given = h.startsWith('Bearer ') ? h.slice(7) : '';
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'ok' : 'denied';
}

const FILTERS = { audience: 'Q04', experience: 'Q01', growth: 'Q05', collab: 'Q17', spend: 'Q27' };

// Human label for a stored answer.
function labelFor(qid, rec) {
  const def = QUESTION_BY_ID[qid];
  if (!def || !rec) return '';
  if (rec.state !== 'answered') return rec.state === 'skipped' ? '(skipped)' : rec.state === 'unanswered' ? '(unanswered)' : '';
  const label = v => (def.options || []).find(o => o.v === v)?.label || v;
  if (def.type === 'text') return rec.text || '';
  if (def.type === 'text_or_none') return rec.mode === 'none' ? (def.noneLabel || 'None') : (rec.text || '');
  if (def.type === 'single') return label(rec.value) + (rec.text ? `: ${rec.text}` : '');
  if (def.type === 'multi' || def.type === 'multi_text') {
    const parts = (rec.values || []).map(label);
    if (rec.text) parts.push(rec.text);
    return parts.join(' | ');
  }
  return '';
}

async function loadRows(url) {
  const includeTest = url.searchParams.get('include_test') === '1';
  const status = url.searchParams.get('status');
  const conds = [], params = [];
  if (!includeTest) conds.push('test = false');
  if (status === 'completed' || status === 'in_progress') { params.push(status); conds.push(`status = $${params.length}`); }
  const where = conds.length ? `where ${conds.join(' and ')}` : '';
  const r = await q(
    `select id, survey_version, status, test, consent_at, answers, future_interest, last_question, source, started_at, completed_at
     from research_responses ${where} order by started_at desc limit 5000`, params);
  let rows = r.rows;
  for (const [param, qid] of Object.entries(FILTERS)) {
    const want = url.searchParams.get(param);
    if (!want) continue;
    rows = rows.filter(row => {
      const a = row.answers?.[qid];
      if (!a || a.state !== 'answered') return false;
      return a.value === want || (Array.isArray(a.values) && a.values.includes(want));
    });
  }
  return rows;
}

function anonymised(row) {
  const answers = {};
  for (const def of RESEARCH_QUESTIONS) {
    const rec = row.answers?.[def.id];
    answers[def.id] = { state: rec?.state || 'unanswered', display: labelFor(def.id, rec), text: rec?.text || null };
  }
  return {
    id: row.id,
    surveyVersion: row.survey_version,
    status: row.status,
    test: row.test,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastQuestion: row.last_question,
    source: row.source,
    futureInterest: row.future_interest || null,
    answers,
  };
}

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheets treating a cell as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function handleResearchAdmin(req, res, url, path) {
  const state = adminOk(req);
  if (state === 'unset') { send(res, 503, { error: 'The researcher view is not set up yet.' }); return true; }
  if (state === 'denied') { send(res, 401, { error: 'Not authorised.' }); return true; }
  if (!allowed('admin', req.socket.remoteAddress || 'unknown')) { send(res, 429, { error: 'Too many requests.' }); return true; }

  if (req.method === 'GET' && path === '/api/research/admin/summary') {
    const rows = await loadRows(url);
    const started = rows.length;
    const completed = rows.filter(r => r.status === 'completed').length;
    const stale = Date.now() - 2 * 60 * 60 * 1000;
    const notFinished = rows.filter(r => r.status === 'in_progress');
    const abandoned = notFinished.filter(r => new Date(r.started_at).getTime() < stale).length;
    const dropOff = {};
    for (const r of notFinished) { const k = r.last_question || 'before first question'; dropOff[k] = (dropOff[k] || 0) + 1; }
    const contacts = await q(`select count(*)::int as n from research_contacts`);
    send(res, 200, {
      version: SURVEY_VERSION,
      started, completed, inProgress: notFinished.length, abandoned,
      completionRate: started ? Math.round((completed / started) * 100) : null,
      dropOff,
      contactsOnFile: contacts.rows[0].n,
      note: 'Abandoned means not finished and not updated for 2 hours. Test responses are excluded unless include_test=1.',
    });
    return true;
  }

  if (req.method === 'GET' && path === '/api/research/admin/responses') {
    const rows = await loadRows(url);
    send(res, 200, { count: rows.length, rows: rows.map(anonymised) });
    return true;
  }

  if (req.method === 'GET' && path === '/api/research/admin/export') {
    const rows = (await loadRows(url)).map(anonymised);
    const format = url.searchParams.get('format') === 'json' ? 'json' : 'csv';
    if (format === 'json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="research-responses.json"', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ version: SURVEY_VERSION, rows }, null, 2));
      return true;
    }
    const head = ['response_id', 'status', 'test', 'started_at', 'completed_at', 'last_question', 'source', 'future_interest'];
    for (const d of RESEARCH_QUESTIONS) head.push(d.id, `${d.id}_state`, `${d.id}_free_text`);
    const lines = [head.map(csvCell).join(',')];
    for (const r of rows) {
      const cells = [r.id, r.status, r.test, r.startedAt, r.completedAt, r.lastQuestion, r.source, (r.futureInterest || []).join(' | ')];
      for (const d of RESEARCH_QUESTIONS) {
        const a = r.answers[d.id];
        cells.push(a.state === 'answered' ? a.display : '', a.state, a.text || '');
      }
      lines.push(cells.map(csvCell).join(','));
    }
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="research-responses.csv"', 'cache-control': 'no-store' });
    res.end(lines.join('\n') + '\n');
    return true;
  }

  // Voluntary contacts: listed and deleted separately from responses.
  if (req.method === 'GET' && path === '/api/research/admin/contacts') {
    const r = await q(`select id, preferred_name, contact_method, contact_value, timezone, activities, created_at from research_contacts order by created_at desc`);
    send(res, 200, { rows: r.rows });
    return true;
  }

  if (req.method === 'POST' && path === '/api/research/admin/contacts/delete') {
    const { id } = await readJson(req);
    if (!isUuid(id)) { send(res, 400, { error: 'Not a valid id.' }); return true; }
    await q(`delete from research_contacts where id=$1`, [id]);
    send(res, 200, { ok: true });
    return true;
  }

  return false;
}

// Retention. Unfinished and test answers after 30 days, completed answers after 24 months,
// contact details after 12 months. Runs every six hours, next to the other purge job.
export async function purgeResearch() {
  const a = await q(`delete from research_responses
    where (status = 'in_progress' or test = true) and updated_at < now() - interval '30 days'`);
  const b = await q(`delete from research_responses
    where status = 'completed' and completed_at < now() - interval '24 months'`);
  const c = await q(`delete from research_contacts where created_at < now() - interval '12 months'`);
  return a.rowCount + b.rowCount + c.rowCount;
}

export function startResearchPurge() {
  const run = async () => {
    try { const n = await purgeResearch(); if (n) console.log(`[research] removed ${n} records past retention`); }
    catch (e) { console.error('[research purge]', e.message); }
  };
  run();
  return setInterval(run, 6 * 3600 * 1000);
}
