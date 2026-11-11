import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Keeps the iOS association file and the redirects in step with the paths the
// app opens. Mirrors APP_LINK_IOS_PATHS in the app repo's lib/deepLink.js
// (the app's scripts/test-android-links.mjs checks that list against app.json):
// change one, change both.
const root = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const expected = ['/l/*', '/s/*', '/e/*', '/v/*', '/reset-password', '/reset-password/*'];
const aasa = JSON.parse(read('.well-known/apple-app-site-association'));
const paths = aasa.applinks.details.flatMap((d) => d.paths);
assert.deepEqual([...paths].sort(), [...expected].sort(), 'apple-app-site-association paths match the app');

const redirects = read('_redirects');
for (const route of ['/l/*', '/s/*', '/e/*', '/v/*', '/reset-password']) {
  assert.ok(redirects.split(/\r?\n/).some((line) => line.trim().split(/\s+/)[0] === route), `${route} is served`);
}
console.log('app links: ok');
