#!/usr/bin/env node
/* npm run deploy: push main, then publish public/ to GitHub Pages.

   The one-liner this replaces had two holes. npm test reads the files on disk,
   but the subtree split publishes the last commit, so a half-made commit (app.js
   bumped, build.txt left behind) passed the tests and still shipped a pair that
   makes every phone believe it is permanently out of date. And if the split
   printed nothing, the push became ":refs/heads/gh-pages", which is git for
   "delete gh-pages": the web app gone, and installed copies getting a 404.

   So this refuses to start unless what is on disk is exactly the commit it will
   publish, and it looks inside the split commit before anything is pushed. The
   checks are exported so a test can run them against a throwaway repository. */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const BRANCH = 'main';
export const PREFIX = 'public';
// The site cannot load or update without these: the page, the app, the worker
// that serves it offline, and the stamp the updater compares against.
export const REQUIRED = ['index.html', 'app.js', 'sw.js', 'build.txt'];

const REPO = fileURLToPath(new URL('..', import.meta.url));

export function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

/** Throws unless HEAD is main: main is what gets pushed, HEAD is what gets split. */
export function checkBranch(cwd = REPO) {
  let branch = '';
  try {
    branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
  } catch {
    // Detached HEAD: no branch name, which the message below reports.
  }
  if (branch !== BRANCH) {
    throw new Error(`deploy runs from ${BRANCH}, but HEAD is ${branch || 'detached'}. ` +
      `The site would be split from one commit while ${BRANCH} pushes another.`);
  }
}

/** Every change the tests would see but the deploy would not publish, as `git status` lines. */
export function uncommitted(cwd = REPO) {
  const lines = [
    // Tracked files that differ from HEAD, staged or not, anywhere: main is pushed whole.
    ...git(['status', '--porcelain', '--untracked-files=no'], cwd).split('\n'),
    // New files under public/ as well: the tests would load them from disk, the split would leave them out.
    // Untracked files elsewhere (notes, scratch) are not published and do not change what is tested.
    ...git(['status', '--porcelain', '--untracked-files=all', '--', PREFIX], cwd).split('\n'),
  ];
  return [...new Set(lines.filter(Boolean))];
}

/** The commit that becomes gh-pages: public/ from HEAD, moved to the root. */
export function splitPublic(cwd = REPO) {
  const sha = git(['subtree', 'split', '--prefix', PREFIX, 'HEAD'], cwd).trim();
  if (!/^[0-9a-f]{40,64}$/.test(sha)) {
    throw new Error(`git subtree split gave "${sha}" instead of a commit. Pushing that could delete gh-pages.`);
  }
  return sha;
}

/** Throws unless the split commit exists and holds the whole site at its root. */
export function checkSplit(sha, cwd = REPO) {
  if (!sha) throw new Error('no split commit. Pushing an empty name to gh-pages deletes it.');
  const names = git(['ls-tree', '--name-only', `${sha}^{commit}`], cwd).split('\n');
  const missing = REQUIRED.filter((name) => !names.includes(name));
  if (missing.length) {
    throw new Error(`the split commit ${sha.slice(0, 7)} has no ${missing.join(', ')} at its root. ` +
      'Publishing it would break the site.');
  }
}

export function deploy(cwd = REPO) {
  checkBranch(cwd);
  const dirty = uncommitted(cwd);
  if (dirty.length) {
    throw new Error(`commit or stash these first, so the tests run on what gets published:\n${dirty.join('\n')}`);
  }
  try {
    execFileSync('npm', ['test'], { cwd, stdio: 'inherit' });
  } catch {
    throw new Error('the tests failed. Nothing was pushed.');
  }
  // Split and inspect before the first push, so a bad split leaves both branches untouched.
  const sha = splitPublic(cwd);
  checkSplit(sha, cwd);
  execFileSync('git', ['push', 'origin', BRANCH], { cwd, stdio: 'inherit' });
  execFileSync('git', ['push', '-f', 'origin', `${sha}:refs/heads/gh-pages`], { cwd, stdio: 'inherit' });
  console.log(`\n  gh-pages is now ${sha.slice(0, 7)}, public/ from ${git(['rev-parse', '--short', 'HEAD'], cwd)}\n`);
}

// Run only as `node scripts/deploy.mjs`; importing it (the test does) pushes nothing.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    deploy();
  } catch (err) {
    console.error(`\n  deploy stopped: ${err.message}\n`);
    process.exit(1);
  }
}
