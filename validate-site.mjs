// Checks the static site before it's published: every page and asset a
// page links to exists, every rewrite target exists, and nothing that
// shouldn't be public is in the published folder (source maps, env files,
// keys). Run with `node validate-site.mjs`; CI runs it on every pull request.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(path.join(root, file), 'utf8');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err.message);
    process.exitCode = 1;
  }
}

// Every published file (the repo minus git, CI and tooling).
const SKIP_DIRS = new Set(['.git', '.github', 'node_modules']);
function walk(dir) {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = dir ? `${dir}/${name}` : name;
    if (SKIP_DIRS.has(name)) return [];
    return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });
}
const files = walk('');
const htmlFiles = files.filter((f) => f.endsWith('.html'));

const redirects = read('_redirects').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => { const [source, target, status] = l.split(/\s+/); return { source, target, status }; });

// Routes served by a rewrite (e.g. /privacy → privacy.html) or proxied.
const routes = new Set(redirects.map((r) => r.source));
const proxied = redirects.filter((r) => /^https:\/\//.test(r.target)).map((r) => r.source.replace(/\*$/, ''));

function exists(urlPath) {
  const clean = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  if (clean === '/' || routes.has(clean)) return true;
  if (proxied.some((p) => clean.startsWith(p))) return true;
  const rel = clean.replace(/^\//, '');
  return [rel, `${rel}.html`, `${rel}/index.html`].some((f) => f && existsSync(path.join(root, f)) && statSync(path.join(root, f)).isFile());
}

check('every rewrite points at a page that exists', () => {
  for (const r of redirects) {
    if (/^https:\/\//.test(r.target)) {
      assert.match(r.target, /^https:\/\/hobbymatch-api-production\.up\.railway\.app\//, `${r.source} proxies somewhere unexpected: ${r.target}`);
      continue;
    }
    assert.ok(existsSync(path.join(root, r.target.replace(/^\//, ''))), `${r.source} → ${r.target}, which doesn't exist`);
  }
});

check('every local link, image, script and stylesheet on every page exists', () => {
  const missing = [];
  for (const file of htmlFiles) {
    const html = read(file);
    for (const m of html.matchAll(/\s(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
      const url = m[1].trim();
      if (/^(?:https?:|mailto:|tel:|data:|#|javascript:)/i.test(url) || url.includes('${')) continue;
      const abs = url.startsWith('/') ? url : `/${path.posix.join(path.posix.dirname(file), url)}`;
      if (!exists(abs)) missing.push(`${file}: ${url}`);
    }
    for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const url = m[1].trim();
      if (/^(?:https?:|data:|#)/i.test(url)) continue;
      const abs = url.startsWith('/') ? url : `/${path.posix.join(path.posix.dirname(file), url)}`;
      if (!exists(abs)) missing.push(`${file}: url(${url})`);
    }
  }
  assert.deepEqual(missing, [], `broken local links:\n  ${missing.join('\n  ')}`);
});

check('pages only load scripts from this site or Cloudflare Turnstile', () => {
  const outside = [];
  for (const file of htmlFiles) {
    for (const m of read(file).matchAll(/<script\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)) {
      if (/^https?:/i.test(m[1]) && !m[1].startsWith('https://challenges.cloudflare.com/')) outside.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(outside, [], `outside scripts (a compromised CDN could run code on the site):\n  ${outside.join('\n  ')}`);
});

check('nothing private is published (source maps, env files, keys, backups)', () => {
  const bad = files.filter((f) => /(^|\/)\.env(\.|$)|\.map$|\.pem$|\.key$|\.p12$|\.sql$|\.bak$|\.swp$|~$|(^|\/)\.DS_Store$|(^|\/)id_(rsa|ed25519)/i.test(f));
  assert.deepEqual(bad, [], `these would be downloadable by anyone:\n  ${bad.join('\n  ')}`);
});

check('no secret-looking values in published files', () => {
  const patterns = [
    /sk-ant-[A-Za-z0-9_-]{20,}/,                 // Anthropic key
    /\bre_[A-Za-z0-9]{20,}/,                      // Resend key
    /service_role/,                               // Supabase service key marker
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}/,               // GitHub token
    /\bAKIA[0-9A-Z]{16}\b/,                        // AWS key
  ];
  const hits = [];
  for (const f of files.filter((x) => /\.(html|js|mjs|css|json|txt|xml)$/i.test(x) || !path.extname(x))) {
    if (f === 'validate-site.mjs') continue;
    const text = read(f);
    for (const p of patterns) if (p.test(text)) hits.push(`${f}: ${p}`);
  }
  assert.deepEqual(hits, [], `possible secrets:\n  ${hits.join('\n  ')}`);
});

console.log(`site: ${passed} checks passed`);
