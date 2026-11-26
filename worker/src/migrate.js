// Applies worker/migrations/*.sql in order, once each. Runs on every worker start.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migrate() {
  const c = await pool.connect();
  try {
    await c.query(`create table if not exists _streamwing_migrations (name text primary key, applied_at timestamptz default now())`);
    const done = new Set((await c.query(`select name from _streamwing_migrations`)).rows.map(r => r.name));
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort() : [];
    for (const f of files) {
      if (done.has(f)) continue;
      await c.query('begin');
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query(`insert into _streamwing_migrations (name) values ($1)`, [f]);
      await c.query('commit');
      console.log(`[migrate] applied ${f}`);
    }
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate();
  await pool.end();
}
