/* The app's own sheets (public/sheet.js), where a browser's confirm() box used to be.

   Checked here: a question that was written as one run of words comes apart into the sentence that asks (the
   sheet's title) and what it means (its body), and app.js no longer reaches for the browser's own boxes at all. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitQuestion } from '../public/sheet.js';

let pass = 0;
const test = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

test('a question that comes first is the title, and the rest is the body', () => {
  assert.deepEqual(splitQuestion('Delete Juno? Juno’s profile goes, and cannot be got back.'),
    { title: 'Delete Juno?', body: 'Juno’s profile goes, and cannot be got back.' });
  assert.deepEqual(splitQuestion('Restore the backup from 3 May 2026? It adds 2 sessions. Nothing on this phone is deleted.'),
    { title: 'Restore the backup from 3 May 2026?', body: 'It adds 2 sessions. Nothing on this phone is deleted.' });
});

test('a question led up to by a line of explanation is still the title', () => {
  assert.deepEqual(splitQuestion('That walk starts a long way from this plan. Use it anyway?'),
    { title: 'Use it anyway?', body: 'That walk starts a long way from this plan.' });
  assert.deepEqual(splitQuestion('Your phone has no track of the walk yet. Finish anyway? The handler gets nothing back.'),
    { title: 'Finish anyway?', body: 'Your phone has no track of the walk yet. The handler gets nothing back.' });
});

test('a distance with a decimal point is not the end of a sentence', () => {
  assert.deepEqual(splitQuestion('The line is 1.2 km from the laid trail. Use it anyway?'),
    { title: 'Use it anyway?', body: 'The line is 1.2 km from the laid trail.' });
});

test('a name with a full stop in it stays whole when the question is known to come first', () => {
  assert.deepEqual(splitQuestion('Delete J. Smith? J. Smith’s profile goes, and cannot be got back.', true),
    { title: 'Delete J. Smith?', body: 'J. Smith’s profile goes, and cannot be got back.' });
});

test('words with no question in them, or nothing at all, are a title and no body', () => {
  assert.deepEqual(splitQuestion('Everything in this backup is already on this phone.'),
    { title: 'Everything in this backup is already on this phone.', body: '' });
  assert.deepEqual(splitQuestion(''), { title: '', body: '' });
  assert.deepEqual(splitQuestion(null), { title: '', body: '' });
  assert.deepEqual(splitQuestion('Go live?'), { title: 'Go live?', body: '' });
});

test('line breaks in the old boxes become spaces', () => {
  assert.deepEqual(splitQuestion('Anyone with the link can follow the run.\n\nGo live?'),
    { title: 'Go live?', body: 'Anyone with the link can follow the run.' });
});

test('app.js asks with the app’s own sheets, never the browser’s boxes', () => {
  const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(js, /(?<![\w.])(confirm|alert|prompt)\(/);
  assert.match(js, /import \{ ask, askQ, tell \} from '\.\/sheet\.js';/);
});

console.log(`\n${pass} passed`);
