// CI adapter only. The original evaluation and its expected outcomes are unchanged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finished } from 'node:stream/promises';

const here = path.dirname(fileURLToPath(import.meta.url));
const worker = path.resolve(here, '..');
const output = path.join(worker, 'test-results/owl-eval');
await mkdir(output, { recursive: true });
const summaryFile = path.join(output, 'summary.json');

try {
  assert.ok(!process.env.ONLY, 'CI must run every original scenario; ONLY is forbidden');
  assert.ok(process.env.EVAL_DATABASE_URL, 'EVAL_DATABASE_URL must name a throwaway database');
  const database = new URL(process.env.EVAL_DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname),
    'Evaluation destroys its database: only a local throwaway database is allowed');
  assert.match(database.pathname, /^\/streamwing_(acceptance|owl_eval)$/,
    'Use the dedicated streamwing_acceptance or streamwing_owl_eval database');

  const manifest = JSON.parse(await readFile(path.join(here, 'owl-eval-manifest.json'), 'utf8'));
  const original = path.join(here, 'owl-eval.mjs');
  assert.equal(createHash('sha256').update(await readFile(original)).digest('hex'), manifest.sha256,
    'Original Owl evaluation changed');
  assert.equal(manifest.scenarios.length, 19);
  assert.equal(manifest.scenarios.filter(s => s.scored).length, 18);

  const resultFile = path.join(output, 'results.json');
  // Remove stale results before launching: a crash must never reuse a previous run.
  const { rm } = await import('node:fs/promises');
  await rm(resultFile, { force: true });
  const log = createWriteStream(path.join(output, 'evaluation.log'));
  const child = spawn(process.execPath, [original, worker, resultFile], {
    cwd: worker, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 480_000,
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
  }
  const exit = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal }));
  }).finally(async () => { log.end(); await finished(log); });
  assert.equal(exit.code, 0, `Evaluation crashed or timed out: ${JSON.stringify(exit)}`);

  const { results } = JSON.parse(await readFile(resultFile, 'utf8'));
  assert.equal(results.length, manifest.scenarios.length, 'Missing or extra scenarios');
  assert.equal(new Set(results.map(r => r.id)).size, results.length, 'Duplicate scenarios');
  for (const expected of manifest.scenarios) {
    const actual = results.find(r => r.id === expected.id);
    assert.ok(actual, `Missing scenario ${expected.id}`);
    for (const key of ['group', 'title', 'expected']) {
      assert.equal(actual[key], expected[key], `Original ${expected.id} ${key} changed`);
    }
    assert.ok(expected.scored ? typeof actual.pass === 'boolean' : actual.pass === null,
      `Scenario ${expected.id} must retain its original scoring status`);
  }
  const failed = results.filter(r => r.pass === false).map(r => r.id);
  const summary = {
    passed: results.filter(r => r.pass === true).length,
    failed: failed.length, measuredOnly: results.filter(r => r.pass === null).length,
    failedScenarios: failed, originalSha256: manifest.sha256,
  };
  await writeFile(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  console.log('Owl acceptance gate:', JSON.stringify(summary));
  // The original harness deliberately exits zero. CI must judge its scored results.
  if (failed.length) process.exitCode = 1;
} catch (error) {
  console.error('Owl acceptance gate failed:', error.message);
  await writeFile(summaryFile, JSON.stringify({ error: error.message }, null, 2) + '\n');
  process.exitCode = 1;
}
