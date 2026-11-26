// Writes the shared header and footer into every page that has the chrome markers.
// Run: node tools/build.mjs            (writes the pages)
//      node tools/build.mjs --check    (exits 1 if any page is out of date)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../site/', import.meta.url).pathname;
const partials = {
  header: readFileSync(new URL('./partials/header.html', import.meta.url), 'utf8').trimEnd(),
  footer: readFileSync(new URL('./partials/footer.html', import.meta.url), 'utf8').trimEnd(),
};

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? htmlFiles(p) : name.endsWith('.html') ? [p] : [];
  });
}

function stamp(html) {
  for (const [name, body] of Object.entries(partials)) {
    const re = new RegExp(`<!-- chrome:${name} -->[\\s\\S]*?<!-- /chrome:${name} -->`);
    html = html.replace(re, `<!-- chrome:${name} -->${body}<!-- /chrome:${name} -->`);
  }
  return html;
}

const check = process.argv.includes('--check');
let stale = 0;
for (const file of htmlFiles(root)) {
  const before = readFileSync(file, 'utf8');
  if (!before.includes('<!-- chrome:')) continue;
  const after = stamp(before);
  if (after === before) continue;
  stale++;
  const rel = relative(root, file);
  if (check) console.log(`out of date: ${rel}`);
  else { writeFileSync(file, after); console.log(`updated: ${rel}`); }
}
if (check && stale) { console.error(`${stale} page(s) out of date. Run: node tools/build.mjs`); process.exit(1); }
if (check) console.log('shared header and footer match on every page');
