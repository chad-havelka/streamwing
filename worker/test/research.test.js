// Performer research: branching, validation and the HTTP flow.
// The branch and validation tests need nothing but Node. The HTTP tests need TEST_DATABASE_URL
// pointing at an empty throwaway Postgres, and are skipped when it is not set.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {
  applicableIds, pruneAnswers, checkAnswer, checkResponse, normalise, cleanText, QUESTION_BY_ID,
} from '../src/research-survey.js';

const A = (value) => ({ state: 'answered', value });
const M = (...values) => ({ state: 'answered', values });
const T = (text) => ({ state: 'answered', text });
const has = (answers, id) => applicableIds(answers).has(id);

// ---- Branching -------------------------------------------------------------

test('Not at all asks when they last broadcast, and nothing else of that branch', () => {
  const a = { Q02: A('not_at_all') };
  assert.ok(has(a, 'Q02a'));
  assert.ok(!has({ Q02: A('almost_daily') }, 'Q02a'));
});

test('audience-growth follow-up appears for stagnant growth or a Q08 difficulty', () => {
  assert.ok(has({ Q05: A('declined_slightly') }, 'Q11'));
  assert.ok(has({ Q05: A('declined_significantly') }, 'Q11'));
  assert.ok(has({ Q05: A('stayed_same') }, 'Q11'));
  assert.ok(has({ Q08: M('fluctuates') }, 'Q11'));
  assert.ok(!has({ Q05: A('grew_slightly'), Q08: M('spend_rarely_return') }, 'Q11'));
  assert.ok(!has({ Q05: A('not_long_enough') }, 'Q11'));
});

test('collaboration follow-ups only for people who have broadcast together', () => {
  for (const v of ['yes_regular', 'yes_occasional', 'yes_once']) {
    const a = { Q17: A(v) };
    for (const id of ['Q18', 'Q19', 'Q20', 'Q20a', 'Q21', 'Q22']) assert.ok(has(a, id), `${id} after ${v}`);
  }
  for (const v of ['no_considered', 'no_not_considered']) {
    const a = { Q17: A(v) };
    for (const id of ['Q18', 'Q19', 'Q20', 'Q21', 'Q22']) assert.ok(!has(a, id), `${id} after ${v}`);
  }
});

test('Q23 and Q24 are asked of everyone', () => {
  for (const v of ['yes_regular', 'no_considered', 'no_not_considered']) {
    assert.ok(has({ Q17: A(v) }, 'Q23'));
    assert.ok(has({ Q17: A(v) }, 'Q24'));
  }
  assert.ok(has({}, 'Q23'), 'Q23 has no condition, so it applies from the start');
});

test('earnings explanation only when the earnings were shared', () => {
  for (const v of ['equal', 'percentages', 'fixed_payment', 'studio_handled']) {
    assert.ok(has({ Q19: A(v) }, 'Q19a'), v);
  }
  for (const v of ['own_account', 'no_agreement', 'not_shared', 'other', 'prefer_not']) {
    assert.ok(!has({ Q19: A(v) }, 'Q19a'), v);
  }
});

test('Q09: asks Did it work only when a change was described', () => {
  assert.ok(has({ Q09: { state: 'answered', mode: 'text', text: 'New schedule' } }, 'Q09a'));
  assert.ok(!has({ Q09: { state: 'answered', mode: 'none' } }, 'Q09a'));
  assert.ok(has({ Q09: { state: 'answered', mode: 'text', text: 'x' }, Q09a: A('yes') }, 'Q09b'));
  assert.ok(!has({ Q09: { state: 'answered', mode: 'none' }, Q09a: A('yes') }, 'Q09b'));
});

test('Q28: cost and expectations only when a purchase was described', () => {
  assert.ok(has({ Q28: { state: 'answered', mode: 'text', text: 'Lighting' } }, 'Q28a'));
  assert.ok(has({ Q28: { state: 'answered', mode: 'text', text: 'Lighting' } }, 'Q28b'));
  assert.ok(!has({ Q28: { state: 'answered', mode: 'none' } }, 'Q28a'));
  assert.ok(!has({ Q28: { state: 'answered', mode: 'none' } }, 'Q28b'));
});

test('Q22 and Q23 follow-ups', () => {
  assert.ok(has({ Q17: A('yes_once'), Q22: A('yes') }, 'Q22a'));
  assert.ok(!has({ Q17: A('yes_once'), Q22: A('no') }, 'Q22a'));
  assert.ok(has({ Q23: A('yes') }, 'Q23a'));
  assert.ok(has({ Q23: A('yes') }, 'Q23b'));
  assert.ok(!has({ Q23: A('never_considered') }, 'Q23a'));
});

test('Q21 and Q29 follow-ups', () => {
  assert.ok(has({ Q17: A('yes_once'), Q21: A('same') }, 'Q21a'));
  assert.ok(!has({ Q17: A('yes_once') }, 'Q21a'));
  assert.ok(has({ Q29: A('yes') }, 'Q29a'));
  assert.ok(!has({ Q29: A('no') }, 'Q29a'));
});

test('changing an earlier answer clears the answers that no longer apply', () => {
  const before = {
    Q17: A('yes_regular'), Q18: M('one_location'), Q18a: A('two'), Q19: A('equal'), Q19a: T('half each'),
    Q22: A('no'), Q23: A('no'),
  };
  const after = pruneAnswers({ ...before, Q17: A('no_considered') });
  for (const id of ['Q18', 'Q18a', 'Q19', 'Q19a', 'Q22']) assert.equal(after[id], undefined, id);
  assert.ok(after.Q23, 'Q23 applies to everyone, so it stays');
  assert.equal(after.Q17.value, 'no_considered');
});

test('pruning cascades: removing a parent removes its child in the same pass', () => {
  const pruned = pruneAnswers({ Q02: A('almost_daily'), Q02a: A('within_3_months') });
  assert.equal(pruned.Q02a, undefined);
});

// ---- Validation ------------------------------------------------------------

test('single choice must be one of its options', () => {
  assert.equal(checkAnswer(QUESTION_BY_ID.Q01, A('gt_5_years')), null);
  assert.ok(checkAnswer(QUESTION_BY_ID.Q01, A('forever')));
});

test('exclusive options cannot be combined with others', () => {
  const q8 = QUESTION_BY_ID.Q08;
  assert.equal(checkAnswer(q8, M('none')), null);
  assert.ok(checkAnswer(q8, M('none', 'fluctuates')));
  assert.equal(checkAnswer(QUESTION_BY_ID.Q03, M('chaturbate', 'stripchat')), null);
  assert.ok(checkAnswer(QUESTION_BY_ID.Q03, M('not_broadcasting', 'chaturbate')));
});

test('Other text is accepted only where the option is Other, and is length limited', () => {
  assert.equal(checkAnswer(QUESTION_BY_ID.Q03, { state: 'answered', values: ['other'], text: 'Bongacams' }), null);
  assert.ok(checkAnswer(QUESTION_BY_ID.Q03, { state: 'answered', values: ['chaturbate'], text: 'stray' }));
  assert.ok(checkAnswer(QUESTION_BY_ID.Q03, { state: 'answered', values: ['other'], text: 'x'.repeat(301) }));
});

test('optional questions can be skipped, required ones cannot', () => {
  assert.equal(checkAnswer(QUESTION_BY_ID.Q06, { state: 'skipped' }), null);
  assert.ok(checkAnswer(QUESTION_BY_ID.Q01, { state: 'skipped' }));
});

test('submit requires every applicable required question', () => {
  const partial = { Q02: A('occasionally') };
  assert.ok(checkResponse(partial, 'submit'), 'Q01 missing');
  assert.equal(checkResponse(partial, 'progress'), null, 'progress may be partial');
});

test('an answer to a question that does not apply is refused', () => {
  assert.ok(checkResponse({ Q02: A('almost_daily'), Q02a: A('within_3_months') }, 'progress'));
});

test('unknown questions and the post-submit question are refused', () => {
  assert.ok(checkResponse({ Q99: A('x') }, 'progress'));
  assert.ok(checkResponse({ F01: M('no_thanks') }, 'progress'));
});

test('text is trimmed, control characters removed, length limited', () => {
  assert.equal(cleanText('  hi\u0000 there\n '), 'hi there');
  assert.ok(checkAnswer(QUESTION_BY_ID.Q06, T('x'.repeat(2001))));
});

test('stored record gives every research question an explicit state', () => {
  const rec = normalise({ Q02: A('not_at_all'), Q02a: { state: 'skipped' } });
  assert.equal(rec.Q02a.state, 'skipped');
  assert.equal(rec.Q18.state, 'not_applicable');
  assert.equal(rec.Q01.state, 'unanswered');
  assert.equal(rec.Q06.state, 'unanswered');
  assert.equal(rec.Q02.value, 'not_at_all');
});

// ---- HTTP flow -------------------------------------------------------------

const DB = process.env.TEST_DATABASE_URL;
const skip = DB ? false : 'set TEST_DATABASE_URL to run the HTTP tests';

describe('HTTP flow', { skip }, () => {
const ADMIN = 'test-admin-token-' + crypto.randomBytes(8).toString('hex');
let server, base, pool;
const handle = {};

before(async () => {
  process.env.DATABASE_URL = DB;
  process.env.DB_SSL = 'false';
  process.env.TOKEN_KEY = crypto.randomBytes(32).toString('base64');
  process.env.RESEARCH_ADMIN_TOKEN = ADMIN;
  const { migrate } = await import('../src/migrate.js');
  ({ pool } = await import('../src/db.js'));
  ({ handleResearchPublic: handle.pub, handleResearchAdmin: handle.admin } = await import('../src/research.js'));
  await migrate();
  await pool.query('delete from research_contacts; delete from research_responses;');
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    try {
      if (path.startsWith('/api/research/admin/') && await handle.admin(req, res, url, path)) return;
      if (path.startsWith('/api/research/') && await handle.pub(req, res, url, path)) return;
      res.writeHead(404); res.end();
    } catch (e) { res.writeHead(e.status || 500); res.end(JSON.stringify({ error: e.message })); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise(r => server.close(r));
  if (pool) await pool.end();
});
async function call(method, path, body, headers = {}) {
  const r = await fetch(base + path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, type: r.headers.get('content-type') };
}

const consent = { age: true, performer: true, agree: true };
const adminHeaders = { authorization: `Bearer ${ADMIN}` };

test('survey definition is served without internal logic exposed as text', async () => {
  const r = await call('GET', '/api/research/survey');
  assert.equal(r.status, 200);
  assert.equal(r.json.questions.length, 48);
  assert.ok(r.json.questions.every(q => typeof q.text === 'string'));
});

test('start refuses without all three confirmations', async () => {
  const r = await call('POST', '/api/research/start', { consent: { ...consent, age: false } });
  assert.equal(r.status, 400);
});

test('a participant can go through a full path and submit', async () => {
  const s = await call('POST', '/api/research/start', { consent, test: true, source: 'test-run' });
  assert.equal(s.status, 200);
  const id = s.json.id;

  const p = await call('POST', '/api/research/progress', {
    id, lastQuestion: 'Q02', answers: { Q01: A('1_3_years'), Q02: A('not_at_all') },
  });
  assert.equal(p.status, 200);

  const bad = await call('POST', '/api/research/progress', { id, answers: { Q02: A('not_at_all'), Q02a: { state: 'answered', value: 'nonsense' } } });
  assert.equal(bad.status, 400);

  const answers = {
    Q01: A('1_3_years'), Q02: A('not_at_all'), Q02a: A('within_3_months'),
    Q03: M('chaturbate'), Q04: A('10_24'), Q05: A('declined_slightly'),
    Q06: { state: 'skipped' }, Q07: T('A calm night'),
    Q08: M('fluctuates'), Q09: { state: 'answered', mode: 'none' },
    Q10: M('intuition'), Q11: T('Nothing yet'),
    Q12: A('discovery'), Q13: { state: 'skipped' }, Q14: { state: 'skipped' }, Q15: { state: 'skipped' }, Q16: { state: 'skipped' },
    Q17: A('no_considered'), Q23: A('yes'), Q23a: M('scheduling'), Q23b: T('Time zones'),
    Q24: { state: 'skipped' },
    Q25: { state: 'skipped' }, Q26: { state: 'skipped' }, Q27: { state: 'skipped' },
    Q28: { state: 'answered', mode: 'none' }, Q29: { state: 'skipped' }, Q30: { state: 'skipped' }, Q31: { state: 'skipped' },
    Q32: T('=HYPERLINK("x")'), Q33: { state: 'skipped' }, Q34: { state: 'skipped' },
  };
  const early = await call('POST', '/api/research/submit', { id, answers: { Q01: A('1_3_years') } });
  assert.equal(early.status, 400, 'submit must be complete');

  const done = await call('POST', '/api/research/submit', { id, answers });
  assert.equal(done.status, 200);
  const again = await call('POST', '/api/research/submit', { id, answers });
  assert.equal(again.status, 200, 'resubmitting a finished response is harmless');
});

test('researcher routes refuse without the token and work with it', async () => {
  assert.equal((await call('GET', '/api/research/admin/summary')).status, 401);
  assert.equal((await call('GET', '/api/research/admin/summary', undefined, { authorization: 'Bearer wrong' })).status, 401);
  const s = await call('GET', '/api/research/admin/summary?include_test=1', undefined, adminHeaders);
  assert.equal(s.status, 200);
  assert.ok(s.json.completed >= 1);
});

test('test responses are excluded from the default view', async () => {
  const excluded = await call('GET', '/api/research/admin/responses', undefined, adminHeaders);
  const included = await call('GET', '/api/research/admin/responses?include_test=1', undefined, adminHeaders);
  assert.ok(included.json.count > excluded.json.count);
});

test('CSV export has one row per response and guards against spreadsheet formulas', async () => {
  const r = await call('GET', '/api/research/admin/export?format=csv&include_test=1', undefined, adminHeaders);
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/csv/);
  const lines = r.text.trim().split('\n');
  assert.ok(lines.length >= 2, 'header plus at least one response');
  assert.ok(lines[0].startsWith('response_id,status,test'));
  assert.ok(r.text.includes("'=HYPERLINK"), 'formula-looking text is prefixed');
});

test('filters narrow the view by audience size', async () => {
  const r = await call('GET', '/api/research/admin/responses?include_test=1&audience=10_24', undefined, adminHeaders);
  assert.equal(r.json.count, 1);
  const none = await call('GET', '/api/research/admin/responses?include_test=1&audience=500_plus', undefined, adminHeaders);
  assert.equal(none.json.count, 0);
});

test('contact details need permission and are stored without any response link', async () => {
  assert.equal((await call('POST', '/api/research/contact', { method: 'email', value: 'a@b.co' })).status, 400);
  assert.equal((await call('POST', '/api/research/contact', { method: 'email', value: 'not-an-email', permission: true })).status, 400);
  const ok = await call('POST', '/api/research/contact', { method: 'email', value: 'a@b.co', preferredName: 'Sam', permission: true, activities: ['local_events', 'bogus'] });
  assert.equal(ok.status, 200);
  const cols = await pool.query(`select column_name from information_schema.columns where table_name='research_contacts'`);
  assert.ok(!cols.rows.some(r => /response/.test(r.column_name)), 'no link column');
  const list = await call('GET', '/api/research/admin/contacts', undefined, adminHeaders);
  const row = list.json.rows.find(r => r.contact_value === 'a@b.co');
  assert.deepEqual(row.activities, ['local_events']);
  const del = await call('POST', '/api/research/admin/contacts/delete', { id: row.id }, adminHeaders);
  assert.equal(del.status, 200);
});

test('retention removes past-limit records and keeps recent ones', async () => {
  await pool.query('delete from research_contacts; delete from research_responses;');
  const { purgeResearch } = await import('../src/research.js');
  await pool.query(`insert into research_responses (id, survey_version, status, test, consent_at, answers, started_at, updated_at, completed_at) values
    (gen_random_uuid(), 'x', 'in_progress', false, now(), '{}', now() - interval '40 days', now() - interval '40 days', null),
    (gen_random_uuid(), 'x', 'in_progress', false, now(), '{}', now() - interval '2 days', now() - interval '2 days', null),
    (gen_random_uuid(), 'x', 'in_progress', true,  now(), '{}', now() - interval '1 day',   now() - interval '1 day', null),
    (gen_random_uuid(), 'x', 'completed',  false, now(), '{}', now() - interval '3 years', now() - interval '3 years', now() - interval '3 years'),
    (gen_random_uuid(), 'x', 'completed',  false, now(), '{}', now() - interval '1 month', now() - interval '1 month', now() - interval '1 month')`);
  await pool.query(`insert into research_contacts (contact_method, contact_value, created_at) values
    ('email', 'old@example.com', now() - interval '13 months'),
    ('email', 'new@example.com', now() - interval '1 month')`);
  const removed = await purgeResearch();
  assert.equal(removed, 3, 'old unfinished, old completed and old contact removed');
  const r = await pool.query('select count(*)::int as n from research_responses');
  assert.equal(r.rows[0].n, 3, 'recent unfinished, a test answer from yesterday and recent completed remain');
  const c = await pool.query('select contact_value from research_contacts');
  assert.deepEqual(c.rows.map(x => x.contact_value), ['new@example.com']);
});
});
