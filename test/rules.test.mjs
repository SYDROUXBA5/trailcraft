/* The Firestore rules are the only thing the server checks, and they used to
   reach Firebase only when someone pasted the file into the console, so nothing
   said which version was live. firebase.json and .firebaserc now tie the
   repository's file to the project, and npm scripts publish it. Nothing here
   contacts Firebase: these read the files only. */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

let pass = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const projectId = read('public/firebase-config.js').match(/projectId:\s*"([^"]+)"/)[1];

t('firebase.json publishes firestore.rules and nothing else', () => {
  const cfg = JSON.parse(read('firebase.json'));
  assert.deepEqual(cfg, { firestore: { rules: 'firestore.rules' } },
    'no hosting, functions or indexes: the site is on GitHub Pages and nothing else is managed here');
  assert.ok(existsSync(new URL('../firestore.rules', import.meta.url)));
});

t('.firebaserc names the same project the app signs in to', () => {
  const rc = JSON.parse(read('.firebaserc'));
  assert.deepEqual(rc, { projects: { default: projectId } });
});

t('the publish scripts touch only the rules, of that project, with a pinned CLI', () => {
  const { scripts } = JSON.parse(read('package.json'));
  const cli = /^npx --yes firebase-tools@\d+\.\d+\.\d+ deploy --only firestore:rules --project ([\w-]+)( --dry-run)?$/;
  const check = scripts['rules:check'].match(cli);
  const publish = scripts['rules:publish'].match(cli);
  assert.ok(check && publish, 'both scripts are a pinned firebase-tools deploy of firestore:rules only');
  assert.equal(check[1], projectId);
  assert.equal(publish[1], projectId);
  assert.equal(check[2], ' --dry-run', 'the check publishes nothing');
  assert.equal(publish[2], undefined);
  // The test suite must never publish: it would need the owner's login anyway.
  assert.doesNotMatch(scripts.test, /firebase|rules:publish/);
});

t('the setup guide publishes from the project instead of pasting', () => {
  const guide = read('docs/SIGN-IN-SETUP.md');
  assert.match(guide, /## Publishing the rules/);
  assert.match(guide, /npm run rules:publish/);
  assert.match(guide, /firebase-tools@\d+\.\d+\.\d+ login/);
  assert.doesNotMatch(guide, /paste the whole file again/);
  const readme = read('README.md');
  assert.match(readme, /## Database rules[\s\S]*npm run rules:publish/);
});

for (const [name, fn] of tests) {
  await fn();
  pass++;
  console.log(`  ok  ${name}`);
}
console.log(`\n${pass} passed total\n`);
