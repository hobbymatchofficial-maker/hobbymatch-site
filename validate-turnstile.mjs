import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const html = read('turnstile.html');
const redirects = read('_redirects');
const headers = read('_headers');

const baselineCsp = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'";
const turnstileCsp = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com";

function parseRedirects(contents) {
  return contents.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return [];
    const [source, target, status] = trimmed.split(/\s+/);
    return [{ source, target, status }];
  });
}

function parseHeaders(contents) {
  const rules = [];
  let currentRule = null;

  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    if (!/^\s/.test(line)) {
      currentRule = { route: line.trim(), headers: [] };
      rules.push(currentRule);
      continue;
    }

    assert.ok(currentRule, `header without a route: ${line.trim()}`);
    const header = line.trim().match(/^([^:]+):\s*(.*)$/);
    assert.ok(header, `invalid header line: ${line.trim()}`);
    currentRule.headers.push({ name: header[1].trim(), value: header[2].trim() });
  }

  return rules;
}

function ruleMatches(ruleRoute, requestRoute) {
  if (ruleRoute.endsWith('*')) return requestRoute.startsWith(ruleRoute.slice(0, -1));
  return ruleRoute === requestRoute;
}

function headerValuesForRoute(rules, requestRoute, headerName) {
  return rules
    .filter((rule) => ruleMatches(rule.route, requestRoute))
    .flatMap((rule) => rule.headers)
    .filter((header) => header.name.toLowerCase() === headerName.toLowerCase())
    .map((header) => header.value);
}

const redirectRules = parseRedirects(redirects);
const headerRules = parseHeaders(headers);
const htmlFiles = readdirSync(root).filter((file) => file.endsWith('.html'));
const normalHtmlFiles = htmlFiles.filter((file) => file !== 'turnstile.html');
const normalRoutes = new Set();

for (const file of normalHtmlFiles) {
  normalRoutes.add(`/${file}`);
  normalRoutes.add(`/${file.slice(0, -'.html'.length)}`);
  if (file === 'index.html') normalRoutes.add('/');
}

for (const redirect of redirectRules) {
  if (normalHtmlFiles.includes(redirect.target.slice(1))) normalRoutes.add(redirect.source);
}

const turnstileRewrite = redirectRules.filter((rule) => rule.source === '/turnstile');
assert.equal(turnstileRewrite.length, 1, 'exactly one /turnstile rewrite is required');
assert.deepEqual(
  turnstileRewrite[0],
  { source: '/turnstile', target: '/turnstile.html', status: '200' },
  '/turnstile must rewrite to /turnstile.html with status 200'
);

assert.doesNotMatch(headers, /^\s*!\s*Content-Security-Policy\b/im, 'Cloudflare Pages header-detachment syntax is not valid on Netlify');

const globalRules = headerRules.filter((rule) => rule.route === '/*');
assert.equal(globalRules.length, 1, 'exactly one global security-header rule is required');
const expectedGlobalHeaders = new Map([
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['x-frame-options', 'DENY'],
  ['permissions-policy', 'camera=(), microphone=(), geolocation=()'],
]);
for (const [name, value] of expectedGlobalHeaders) {
  assert.deepEqual(
    globalRules[0].headers.filter((header) => header.name.toLowerCase() === name).map((header) => header.value),
    [value],
    `global ${name} header changed or is duplicated`
  );
}
assert.equal(
  globalRules[0].headers.some((header) => header.name.toLowerCase() === 'content-security-policy'),
  false,
  'the global rule must not set CSP because it overlaps the Turnstile routes'
);

const turnstileRoutes = new Set(['/turnstile', '/turnstile.html']);
const expectedCspRoutes = new Set([...normalRoutes, ...turnstileRoutes]);
const cspRules = headerRules.filter((rule) =>
  rule.headers.some((header) => header.name.toLowerCase() === 'content-security-policy')
);

assert.equal(cspRules.length, expectedCspRoutes.size, 'CSP rules must cover exactly the known HTML documents and public routes');
assert.equal(new Set(cspRules.map((rule) => rule.route)).size, cspRules.length, 'duplicate CSP route rules could emit multiple CSP headers');
for (const rule of cspRules) {
  assert.equal(rule.route.includes('*') || rule.route.includes(':'), false, `CSP rule must use an exact route: ${rule.route}`);
  assert.ok(expectedCspRoutes.has(rule.route), `unexpected CSP route: ${rule.route}`);
}

for (const route of normalRoutes) {
  const values = headerValuesForRoute(headerRules, route, 'Content-Security-Policy');
  assert.deepEqual(values, [baselineCsp], `${route} must receive exactly one baseline CSP`);
  assert.equal(values[0].includes('https://challenges.cloudflare.com'), false, `${route} must not receive Turnstile allowances`);
}

for (const route of turnstileRoutes) {
  assert.deepEqual(
    headerValuesForRoute(headerRules, route, 'Content-Security-Policy'),
    [turnstileCsp],
    `${route} must receive exactly one Turnstile-compatible CSP`
  );
}

assert.equal(
  (turnstileCsp.match(/https:\/\/challenges\.cloudflare\.com/g) || []).length,
  3,
  'Turnstile CSP must contain exactly three Cloudflare allowances'
);
assert.match(turnstileCsp, /script-src[^;]*https:\/\/challenges\.cloudflare\.com/);
assert.match(turnstileCsp, /connect-src[^;]*https:\/\/challenges\.cloudflare\.com/);
assert.match(turnstileCsp, /frame-src[^;]*https:\/\/challenges\.cloudflare\.com/);

assert.match(html, /api\.js\?render=explicit/, 'Turnstile must use explicit rendering');
assert.match(html, /turnstile\.render\(/, 'Turnstile render call is missing');
assert.doesNotMatch(html, /YOUR_CLOUDFLARE_TURNSTILE_SITE_KEY/, 'the public site-key placeholder must be replaced');
const siteKeyMatch = html.match(/var TURNSTILE_SITE_KEY = '([^']+)'/);
assert.ok(siteKeyMatch, 'the public site key is missing');
assert.match(siteKeyMatch[1], /^0x[A-Za-z0-9_-]+$/, 'the public site key format is invalid');

const implementationFiles = [...htmlFiles, '_redirects', '_headers'];
const implementationText = implementationFiles.map(read).join('\n');
const forbiddenMarkers = [
  'TURNSTILE_' + 'SECRET',
  'site' + 'verify',
  'CF_' + 'TURNSTILE_SECRET',
  'CLOUDFLARE_' + 'TURNSTILE_SECRET',
];
for (const marker of forbiddenMarkers) {
  assert.equal(implementationText.toLowerCase().includes(marker.toLowerCase()), false, `forbidden secret marker found: ${marker}`);
}
assert.equal(
  (implementationText.match(/0x[A-Za-z0-9_-]+/g) || []).length,
  1,
  'the repository implementation must contain only the configured public Site key'
);

assert.match(html, /JSON\.stringify\(\{\s*type: 'turnstile-success',\s*token: token\s*\}\)/s, 'success message payload is incorrect');
assert.match(html, /'Verification complete\.'/);
assert.match(html, /'Verification expired\. Please try again\.'/);
assert.match(html, /'Verification could not be completed\. Please try again\.'/);
assert.match(html, /'unsupported-callback': handleUnsupported/);
assert.match(html, /window\.turnstile\.reset\(widgetId\)/, 'retry must reset the widget');
assert.doesNotMatch(html, /console\.(?:log|info|debug|warn|error)\s*\(/, 'the page must not log tokens or challenge data');
assert.equal(
  (html.match(/TURNSTILE_SITE_KEY/g) || []).length,
  2,
  'the public Site key variable must only be declared and passed to Turnstile'
);

console.log('PASS /turnstile rewrites to /turnstile.html with status 200');
console.log('PASS every normal HTML document and public route receives exactly one baseline CSP');
console.log('PASS /turnstile and /turnstile.html receive exactly one CSP with the three required Cloudflare allowances');
console.log('PASS Netlify CSP rules are exact and non-overlapping, with no Cloudflare Pages detachment syntax');
console.log('PASS global security headers are preserved and no Turnstile secret or Siteverify implementation exists');
console.log('PASS explicit rendering, success payload, expiry/error/unsupported handling, and retry reset are present');
