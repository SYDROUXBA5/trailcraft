/* The checks npm run deploy makes before it pushes, run against a throwaway
   repository in the temp directory. Nothing here pushes: only the checks are
   imported, never the deploy itself.

   Each one guards something that went wrong silently before: tests passing on
   files that were never committed, or an empty split turning the gh-pages push
   into a delete. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REQUIRED, checkBranch, uncommitted, splitPublic, checkSplit } from '../scripts/deploy.mjs';

// Keep this machine's git settings (signing, hooks, templates) out of the throwaway repo.
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Trailcraft test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Trailcraft test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
});

const dir = mkdtempSync(join(tmpdir(), 'trailcraft-deploy-'));
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const put = (rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

// A small copy of the project's shape: the site in public/, something beside it.
git('init', '-q', '-b', 'main');
put('README.md', 'readme\n');
for (const name of REQUIRED) put(`public/${name}`, `${name}\n`);
put('public/app.css', 'body {}\n');
git('add', '-A');
git('commit', '-qm', 'site');
git('tag', 'site');

/** Back to the committed site on main, with nothing else lying around. */
function reset() {
  git('checkout', '-q', '-f', 'main');
  git('reset', '-q', '--hard', 'site');
  git('clean', '-qfdx');
}

let pass = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('a clean main passes, and the split is public/ from HEAD with the site at its root', () => {
  checkBranch(dir);
  assert.deepEqual(uncommitted(dir), []);
  const sha = splitPublic(dir);
  checkSplit(sha, dir);
  assert.equal(git('rev-parse', `${sha}^{tree}`), git('rev-parse', 'HEAD:public'));
  const names = git('ls-tree', '--name-only', sha).split('\n');
  for (const name of REQUIRED) assert.ok(names.includes(name), `${name} at the root of gh-pages`);
  assert.ok(!names.includes('README.md'), 'nothing from outside public/');
});

t('app.js committed without build.txt stops the deploy, staged or not', () => {
  put('public/app.js', 'new build\n');
  put('public/build.txt', 'new build\n');
  git('add', 'public/app.js');
  git('commit', '-qm', 'half a bump');
  assert.deepEqual(uncommitted(dir), [' M public/build.txt']);
  git('add', 'public/build.txt');
  assert.deepEqual(uncommitted(dir), ['M  public/build.txt']);
  reset();
});

t('a new file in public/ stops it, since the tests would load it and the split would not', () => {
  put('public/new.js', 'export {};\n');
  assert.deepEqual(uncommitted(dir), ['?? public/new.js']);
  reset();
});

t('an edit outside public/ stops it too, but an untracked note beside the project does not', () => {
  put('README.md', 'edited\n');
  assert.deepEqual(uncommitted(dir), [' M README.md']);
  reset();
  put('notes.txt', 'scratch\n');
  assert.deepEqual(uncommitted(dir), []);
  reset();
});

t('deploying from another branch, or a detached HEAD, is refused', () => {
  git('checkout', '-q', '-b', 'experiment');
  assert.throws(() => checkBranch(dir), /HEAD is experiment/);
  git('checkout', '-q', '--detach', 'site');
  assert.throws(() => checkBranch(dir), /HEAD is detached/);
  reset();
});

t('an empty split is refused before it can become a delete refspec', () => {
  assert.throws(() => checkSplit('', dir), /deletes it/);
  const emptyTree = execFileSync('git', ['hash-object', '-w', '-t', 'tree', '/dev/null'], { cwd: dir, encoding: 'utf8' }).trim();
  const emptyCommit = git('commit-tree', emptyTree, '-m', 'empty');
  assert.throws(() => checkSplit(emptyCommit, dir), new RegExp(REQUIRED.join(', ')));
  git('rm', '-rq', 'public');
  git('commit', '-qm', 'no site');
  assert.throws(() => splitPublic(dir));
  reset();
});

t('a split without any one of the four files is refused, and names it', () => {
  for (const name of REQUIRED) {
    git('rm', '-q', `public/${name}`);
    git('commit', '-qm', `lose ${name}`);
    const sha = splitPublic(dir);
    assert.throws(() => checkSplit(sha, dir), (err) => err.message.includes(`has no ${name} at its root`));
    reset();
  }
});

try {
  for (const [name, fn] of tests) {
    await fn();
    pass++;
    console.log(`  ok  ${name}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} passed total\n`);
