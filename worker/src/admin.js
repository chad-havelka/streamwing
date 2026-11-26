// Adds a performer and prints her private /start link.
// Usage: npm run add-performer -- <chaturbate_username> [display name]
import { q, pool } from './db.js';
import { newAccessKey, hashKey } from './crypto.js';
import { migrate } from './migrate.js';

const [cmd, username, ...rest] = process.argv.slice(2);
if (cmd !== 'add' || !username) {
  console.log('Usage: npm run add-performer -- <chaturbate_username> [display name]');
  process.exit(1);
}
await migrate();
const key = newAccessKey();
await q(
  `insert into performers (cb_username, display_name, access_key_hash) values ($1,$2,$3)
   on conflict (cb_username) do update set access_key_hash = excluded.access_key_hash, display_name = coalesce(excluded.display_name, performers.display_name)`,
  [username, rest.join(' ') || null, hashKey(key)]);
console.log(`${username}'s private link (anyone with it can open her panel):`);
console.log(`https://streamwing.studio/connect/#k=${key}`);
await pool.end();
