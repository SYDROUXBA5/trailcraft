/* The coach's voice. Left to itself an iPhone read the calls in its compact
   voice, and a handler in a field heard a satnav. So the coach names a
   voice: the best this phone holds, in English, never a joke voice, and
   never one that needs a signal ahead of one that does not.

   The choosing is pure and runs here on voice lists taken from real phones
   and browsers. The glue in app.js (the voice cache, the settings rows, the
   Play button) is read from the source, and coachSpeak and the painter are
   lifted out and run against small fakes of the page and the speech engine. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  rankVoices, pickVoice, voiceQuality, voiceLabel, voiceRate, voiceName, voiceAccent, voiceHint,
  coachLang, coachPhrase, SAMPLE_CALL, COACH_DEFAULTS,
} from '../public/coach.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/app.css', import.meta.url), 'utf8');

/** A top-level declaration in app.js, from its head to the brace that closes it at the margin. */
function decl(head) {
  const i = js.indexOf(`\n${head}`);
  assert.ok(i >= 0, `app.js still has ${head}`);
  const j = js.indexOf('\n}', i + 1);
  return js.slice(i + 1, j + 2);
}
/** One line of app.js, found by how it starts. */
function line(head) {
  const l = js.split('\n').find(x => x.startsWith(head));
  assert.ok(l, `app.js still has ${head}`);
  return l;
}

const V = (name, lang, voiceURI, extra = {}) => ({ name, lang, voiceURI, localService: true, default: false, ...extra });

/* An iPhone on iOS 17 with Serena Premium and Daniel Enhanced downloaded:
   the compact voices it ships with, the novelty voices, the Eloquence set
   and other languages all come back from getVoices() too. */
const IOS = [
  V('Samantha', 'en-US', 'com.apple.voice.compact.en-US.Samantha', { default: true }),
  V('Daniel', 'en-GB', 'com.apple.voice.compact.en-GB.Daniel'),
  V('Karen', 'en-AU', 'com.apple.voice.compact.en-AU.Karen'),
  V('Moira', 'en-IE', 'com.apple.voice.compact.en-IE.Moira'),
  V('Rishi', 'en-IN', 'com.apple.voice.compact.en-IN.Rishi'),
  V('Daniel', 'en-GB', 'com.apple.voice.enhanced.en-GB.Daniel'),
  V('Serena', 'en-GB', 'com.apple.voice.premium.en-GB.Serena'),
  V('Albert', 'en-US', 'com.apple.speech.synthesis.voice.Albert'),
  V('Bad News', 'en-US', 'com.apple.speech.synthesis.voice.BadNews'),
  V('Jester', 'en-US', 'com.apple.speech.synthesis.voice.jester'),
  V('Superstar', 'en-US', 'com.apple.speech.synthesis.voice.superstar'),
  V('Zarvox', 'en-US', 'com.apple.speech.synthesis.voice.Zarvox'),
  V('Fred', 'en-US', 'com.apple.speech.synthesis.voice.Fred'),
  V('Eddy (English (UK))', 'en-GB', 'com.apple.eloquence.en-GB.Eddy'),
  V('Grandma (English (US))', 'en-US', 'com.apple.eloquence.en-US.Grandma'),
  V('Shelley (English (UK))', 'en-GB', 'com.apple.eloquence.en-GB.Shelley'),
  V('Thomas', 'fr-FR', 'com.apple.voice.compact.fr-FR.Thomas'),
  V('Anna', 'de-DE', 'com.apple.voice.compact.de-DE.Anna'),
];

/* An iPhone as it comes: nothing downloaded. */
const IOS_FRESH = IOS.filter(v => /compact|speech\.synthesis|eloquence/.test(v.voiceURI));

/* Safari on a Mac: "(Enhanced)" and "(Premium)" in the names, Alex (a
   good plain voice), and the novelty voices under their Mac names. */
const MAC_SAFARI = [
  V('Alex', 'en-US', 'com.apple.speech.synthesis.voice.Alex'),
  V('Daniel', 'en-GB', 'com.apple.voice.compact.en-GB.Daniel'),
  V('Daniel (Enhanced)', 'en-GB', 'com.apple.voice.enhanced.en-GB.Daniel'),
  V('Zoe (Premium)', 'en-US', 'com.apple.voice.premium.en-US.Zoe'),
  V('Fiona', 'en-GB-u-sd-gbsct', 'com.apple.voice.compact.en-GB-u-sd-gbsct.Fiona'),
  V('Pipe Organ', 'en-US', 'com.apple.speech.synthesis.voice.Organ'),
  V('Good News', 'en-US', 'com.apple.speech.synthesis.voice.GoodNews'),
  V('Whisper', 'en-US', 'com.apple.speech.synthesis.voice.Whisper'),
  V('Rocko (English (UK))', 'en-GB', 'com.apple.eloquence.en-GB.Rocko'),
  V('Amélie', 'fr-CA', 'com.apple.voice.compact.fr-CA.Amelie'),
];

/* Chrome on a desktop: the system's own voices, and Google's, which are
   spoken on Google's servers (localService false) and fall silent with no
   signal. */
const CHROME = [
  V('Google US English', 'en-US', 'Google US English', { localService: false }),
  V('Google UK English Female', 'en-GB', 'Google UK English Female', { localService: false }),
  V('Google UK English Male', 'en-GB', 'Google UK English Male', { localService: false }),
  V('Google français', 'fr-FR', 'Google français', { localService: false }),
  V('Microsoft Hazel - English (United Kingdom)', 'en-GB', 'Microsoft Hazel - English (United Kingdom)'),
  V('Microsoft David - English (United States)', 'en-US', 'Microsoft David - English (United States)', { default: true }),
  V('Bad News', 'en-US', 'Bad News'),
];

/* Chrome on Android: Google's speech engine, one voice per language, with
   an older WebView's underscores in the tags. */
const ANDROID = [
  V('English United States', 'en-US', 'English United States', { default: true }),
  V('English United Kingdom', 'en-GB', 'English United Kingdom'),
  V('English India', 'en_IN', 'English India'),
  V('en-gb-x-rjs-network', 'en_GB', 'en-gb-x-rjs-network', { localService: false }),
  V('Français France', 'fr-FR', 'Français France'),
  V('Deutsch Deutschland', 'de-DE', 'Deutsch Deutschland'),
];

const uris = (ranked) => ranked.map(r => r.voice.voiceURI);

/* ── The pure choosing ─────────────────────────────────────────────── */

t('the quality is read from the URI and the name', () => {
  assert.equal(voiceQuality({ voiceURI: 'com.apple.voice.premium.en-GB.Serena', name: 'Serena' }), 'premium');
  assert.equal(voiceQuality({ voiceURI: 'com.apple.voice.enhanced.en-GB.Daniel', name: 'Daniel' }), 'enhanced');
  assert.equal(voiceQuality({ voiceURI: 'com.apple.voice.compact.en-GB.Daniel', name: 'Daniel' }), 'compact');
  assert.equal(voiceQuality({ voiceURI: 'com.apple.ttsbundle.Daniel-compact', name: 'Daniel' }), 'compact');
  assert.equal(voiceQuality({ voiceURI: 'com.apple.ttsbundle.Daniel-premium', name: 'Daniel' }), 'enhanced',
    'before iOS 16, "-premium" was what the Settings app called Enhanced');
  assert.equal(voiceQuality({ voiceURI: 'Daniel', name: 'Daniel (Enhanced)' }), 'enhanced', 'a Mac says it in the name');
  assert.equal(voiceQuality({ voiceURI: 'Google UK English Female', name: 'Google UK English Female' }), 'plain');
  assert.equal(voiceQuality(null), 'plain');
  assert.deepEqual(['premium', 'enhanced', 'plain', 'compact'].map(voiceLabel), ['Natural', 'Enhanced', 'Basic', 'Basic']);
  assert.deepEqual(['premium', 'enhanced', 'plain', 'compact'].map(voiceRate), [1, 1, 1.05, 1.05],
    'a good voice is not hurried; a basic one keeps the pace it had');
});

t('an iPhone: Premium, then Enhanced, then the compact voices; no joke voices, no other languages', () => {
  const r = rankVoices(IOS, 'en-GB');
  assert.deepEqual(uris(r), [
    'com.apple.voice.premium.en-GB.Serena',
    'com.apple.voice.enhanced.en-GB.Daniel',
    'com.apple.voice.compact.en-GB.Daniel',       // the handler's own English leads the compact ones
    'com.apple.voice.compact.en-AU.Karen',
    'com.apple.voice.compact.en-IE.Moira',
    'com.apple.voice.compact.en-IN.Rishi',
    'com.apple.voice.compact.en-US.Samantha',
  ]);
  assert.deepEqual(r.map(x => x.quality), ['premium', 'enhanced', 'compact', 'compact', 'compact', 'compact', 'compact']);
  assert.ok(r.every(x => x.local));
  for (const gone of ['Albert', 'Bad News', 'Jester', 'Superstar', 'Zarvox', 'Fred', 'Eddy', 'Grandma', 'Shelley', 'Thomas', 'Anna']) {
    assert.ok(!r.some(x => x.voice.name.startsWith(gone)), `${gone} is left out`);
  }
});

t('the handler’s own English, or British when the phone speaks another language', () => {
  assert.equal(coachLang('en-AU'), 'en-au');
  assert.equal(coachLang('en_US'), 'en-us');
  assert.equal(coachLang('fr-FR'), 'en-gb', 'a French phone still hears the calls in English');
  assert.equal(coachLang('en'), 'en-gb');
  assert.equal(coachLang(undefined), 'en-gb');
  // Within a quality the handler's own accent comes first…
  assert.equal(rankVoices(IOS_FRESH, 'en-AU')[0].voice.name, 'Karen');
  assert.equal(rankVoices(IOS_FRESH, 'en-US')[0].voice.name, 'Samantha');
  assert.equal(rankVoices(IOS_FRESH, 'fr-FR')[0].voice.name, 'Daniel');
  // …but a natural voice in another accent beats a compact one in their own.
  assert.equal(rankVoices(IOS, 'en-AU')[0].voice.name, 'Serena');
});

t('Safari on a Mac: names say the quality, Alex stays, the organ does not', () => {
  const r = rankVoices(MAC_SAFARI, 'en-GB');
  assert.deepEqual(r.map(x => x.voice.name), ['Zoe (Premium)', 'Daniel (Enhanced)', 'Alex', 'Daniel', 'Fiona']);
  assert.deepEqual(r.map(x => voiceName(x.voice)), ['Zoe', 'Daniel', 'Alex', 'Daniel', 'Fiona'], 'the label says the quality, not the name');
  assert.equal(voiceAccent('en-GB-u-sd-gbsct'), 'Scottish');
  assert.equal(voiceAccent('en_IN'), 'Indian');
  assert.equal(voiceAccent('en-PH'), 'English');
});

t('Chrome on a desktop: a voice that needs a signal comes after every voice on the machine', () => {
  const r = rankVoices(CHROME, 'en-GB');
  assert.deepEqual(r.map(x => x.voice.name), [
    'Microsoft Hazel - English (United Kingdom)',
    'Microsoft David - English (United States)',
    'Google UK English Female',
    'Google UK English Male',
    'Google US English',
  ]);
  assert.deepEqual(r.map(x => x.local), [true, true, false, false, false]);
  assert.equal(pickVoice(CHROME, 'en-GB').name, 'Microsoft Hazel - English (United Kingdom)');
  // Only network voices: better one of them than the browser's guess.
  assert.equal(pickVoice(CHROME.filter(v => !v.localService), 'en-GB').name, 'Google UK English Female');
});

t('Chrome on Android: underscores in the tags, the network voice last', () => {
  const r = rankVoices(ANDROID, 'en-US');
  assert.deepEqual(r.map(x => x.voice.name), ['English United States', 'English India', 'English United Kingdom', 'en-gb-x-rjs-network']);
  assert.equal(pickVoice(ANDROID, 'en-GB').name, 'English United Kingdom');
  assert.equal(pickVoice(ANDROID, 'en_GB').name, 'English United Kingdom');
});

t('the handler’s choice holds while the phone has it, and falls back when it goes', () => {
  assert.equal(pickVoice(IOS, 'en-GB').voiceURI, 'com.apple.voice.premium.en-GB.Serena', 'Automatic is the best');
  assert.equal(pickVoice(IOS, 'en-GB', 'com.apple.voice.compact.en-IE.Moira').voiceURI, 'com.apple.voice.compact.en-IE.Moira');
  assert.equal(pickVoice(IOS, 'en-GB', 'com.apple.voice.premium.en-GB.Malcolm').voiceURI,
    'com.apple.voice.premium.en-GB.Serena', 'a voice deleted since it was chosen: the best one left');
  assert.equal(pickVoice(IOS, 'en-GB', 'com.apple.speech.synthesis.voice.Zarvox').voiceURI,
    'com.apple.voice.premium.en-GB.Serena', 'a joke voice is never used, even when stored');
  assert.equal(pickVoice(IOS, 'en-GB', 'com.apple.voice.compact.fr-FR.Thomas').voiceURI,
    'com.apple.voice.premium.en-GB.Serena', 'nor one that cannot say the English');
  assert.equal(pickVoice([], 'en-GB'), null, 'no voices yet: the browser picks, as it always did');
  assert.equal(pickVoice([], 'en-GB', 'com.apple.voice.premium.en-GB.Serena'), null);
  assert.equal(pickVoice(undefined, 'en-GB'), null);
  assert.equal(pickVoice(IOS.filter(v => !v.lang.startsWith('en')), 'fr-FR'), null, 'no English voice at all');
  assert.deepEqual(rankVoices([], 'en-GB'), []);
});

t('the hint for a better voice: only while there is no Premium one, with the steps only on an iPhone', () => {
  assert.equal(voiceHint(IOS, 'en-GB', { iphone: true }), '', 'Serena is Premium: nothing to say');
  const phone = voiceHint(IOS_FRESH, 'en-GB', { iphone: true });
  assert.equal(phone, 'For the most natural voice, download one on your iPhone: Settings → Accessibility → Spoken Content → Voices → English, then any voice marked Premium.');
  const other = voiceHint(ANDROID, 'en-GB');
  assert.match(other, /natural voice/);
  assert.ok(!/iPhone|Premium|Accessibility/.test(other), 'no iPhone menus on another phone');
  assert.equal(voiceHint([], 'en-GB', { iphone: true }), phone, 'no voices listed: the hint still helps');
});

t('the sample call is the real one, in either unit', () => {
  assert.equal(coachPhrase(SAMPLE_CALL), 'Off the trail, 15 metres to the left');
  assert.equal(coachPhrase(SAMPLE_CALL, { imperial: true }), 'Off the trail, 50 feet to the left');
});

t('the choice starts as Automatic and stays on this phone', () => {
  assert.equal(COACH_DEFAULTS.coachVoiceURI, null);
  assert.equal(COACH_DEFAULTS.coachVoice, true, 'the Voice tile is still the on/off switch');
  // Settings live in this phone's storage only; neither sync nor backup carries them.
  for (const f of ['sync.js', 'sync-core.js', 'backup.js', 'store.js']) {
    const src = readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
    assert.ok(!/coachVoiceURI|tc\.settings/.test(src), `${f} never carries it`);
  }
});

/* ── The page ──────────────────────────────────────────────────────── */

t('the Coach voice block sits with the coach’s other choices', () => {
  const box = html.slice(html.indexOf('id="coachVoiceBox"'), html.indexOf('for="coachShow"'));
  assert.ok(html.indexOf('id="coachControls"') < html.indexOf('id="coachVoiceBox"'), 'inside the coach controls, so the run sheet has it too');
  assert.match(html, /<span class="unit-head" id="coachVoiceHead">Coach voice<\/span>/);
  assert.match(box, /<div class="check-list" id="coachVoiceList" role="group" aria-labelledby="coachVoiceHead"><\/div>/);
  assert.match(box, /id="coachVoiceMore" aria-controls="coachVoiceList" aria-expanded="false" hidden/);
  assert.match(box, /<button type="button" class="btn ghost small" id="coachVoicePlay" aria-describedby="coachVoiceSample">.*Play<\/button>/);
  assert.match(box, /<svg[^>]*aria-hidden="true"/);
  assert.match(box, /id="coachVoiceNone" hidden>This phone has no voice for the coach/);
  assert.match(box, /<p class="coach-cap" id="coachVoiceHint" hidden><\/p>/);
  assert.ok(!/<input/.test(box), 'no checkbox: the coach’s change handler would file it as a setting');
});

t('each voice row says whether it is chosen, from the test that lights it', () => {
  const f = decl('function paintCoachVoice()');
  assert.match(f, /const on = uri === mine;\s*return `<button type="button" class="check-row\$\{on \? ' on' : ''\}" data-voice="\$\{esc\(uri\)\}" aria-pressed="\$\{on\}">/);
  assert.match(f, /\$\{esc\(name\)\}[\s\S]*\$\{esc\(sub\)\}/, 'names from the phone are escaped');
  assert.match(f, /row\('', 'Automatic', `The best voice on this phone/);
  assert.match(f, /ranked\.filter\(\(r, i\) => i < VOICES_SHOWN \|\| r\.voice\.voiceURI === mine\)/, 'a long list is cut, never the chosen voice');
  assert.match(decl('function paintCoachControls()'), /\n {2}paintCoachVoice\(\);\n\}$/, 'drawn whenever the coach controls are');
});

t('the long voice list cannot push the card sideways', () => {
  assert.match(css, /#coachVoiceList \.check-text b \{ overflow-wrap: anywhere; \}/);
  assert.match(css, /\.voice-play \{ display: flex; flex-wrap: wrap;/);
  assert.match(css, /\.voice-play \.coach-cap \{ flex: 1 1 10em; min-width: 0;/);
  const block = css.slice(css.indexOf('#coachVoiceList {'), css.indexOf('.voice-play .coach-cap'));
  assert.ok(!/font-size: \d/.test(block), 'no size in plain pixels here');
});

t('voices that arrive late are taken again and drawn again, keeping focus', () => {
  const w = decl('function wire()');
  assert.match(w, /speechSynthesis\.addEventListener\('voiceschanged', fresh\)/);
  assert.match(w, /else speechSynthesis\.onvoiceschanged = fresh;/, 'where the engine is not an EventTarget');
  assert.match(w, /const fresh = \(\) => \{\s*voiceCache\.list = \[\];\s*voiceList\(\);\s*const at = document\.activeElement;\s*if \(at\) repaintFrom\(at, paintCoachVoice\); else paintCoachVoice\(\);/);
  assert.match(decl('function voiceList()'), /if \(!voiceCache\.list\.length && 'speechSynthesis' in window\)/, 'an empty list is asked for again');
});

t('tapping a voice keeps it, and Play says the sample call in it', () => {
  const w = decl('function wire()');
  const click = w.slice(w.indexOf("$('coachVoiceBox').addEventListener('click'"));
  assert.match(click, /settings\.coachVoiceURI = row\.dataset\.voice \|\| null;\s*saveSettings\(\);\s*return repaintFrom\(row, paintCoachVoice\);/);
  assert.match(click, /voiceCache\.all = !voiceCache\.all;/);
  assert.match(click, /if \(e\.target\.closest\('#coachVoicePlay'\)\) coachSpeak\(coachPhrase\(SAMPLE_CALL, \{ imperial: imp\(\) \}\)\);/);
  // The priming on the first touch is untouched: it still speaks a silent space.
  assert.match(decl('function audioUnlock()'), /const u = new SpeechSynthesisUtterance\(' '\);\s*u\.volume = 0;\s*speechSynthesis\.speak\(u\);/);
  assert.match(w, /document\.addEventListener\('pointerdown', audioUnlock, \{ once: true \}\);/);
});

/* ── Run for real ──────────────────────────────────────────────────── */

/** coachSpeak and the voice cache, lifted out, with a fake speech engine. */
function speaker(list, { lang = 'en-GB', chosen = null } = {}) {
  const said = [];
  const speechSynthesis = { getVoices: () => list, cancel() {}, speak: (u) => said.push(u) };
  const sb = {
    window: {}, navigator: { language: lang }, speechSynthesis, settings: { coachVoiceURI: chosen },
    pickVoice, voiceRate, voiceQuality,
    SpeechSynthesisUtterance: function (text) { this.text = text; },
  };
  sb.window.speechSynthesis = speechSynthesis;
  vm.createContext(sb);
  vm.runInContext([line('const voiceCache = '), decl('function voiceList()'), decl('function coachSpeak(text)'),
    'this.coachSpeak = coachSpeak; this.voiceCache = voiceCache;'].join('\n'), sb);
  return { sb, said };
}

t('coachSpeak names the voice, and paces it by its quality', () => {
  const { sb, said } = speaker(IOS);
  sb.coachSpeak('Back on the trail');
  assert.equal(said.length, 1);
  assert.equal(said[0].voice.voiceURI, 'com.apple.voice.premium.en-GB.Serena');
  assert.equal(said[0].lang, 'en-GB', 'the voice’s own language, so the engine does not swap it');
  assert.equal(said[0].rate, 1);
  const moira = speaker(IOS, { chosen: 'com.apple.voice.compact.en-IE.Moira' });
  moira.sb.coachSpeak('Still off');
  assert.equal(moira.said[0].voice.name, 'Moira');
  assert.equal(moira.said[0].lang, 'en-IE');
  assert.equal(moira.said[0].rate, 1.05);
});

t('with no voice to name, coachSpeak speaks exactly as it did', () => {
  const { sb, said } = speaker([], { lang: 'fr-FR' });
  sb.coachSpeak('Off the trail');
  assert.equal(said[0].voice, undefined);
  assert.equal(said[0].lang, 'fr-FR');
  assert.equal(said[0].rate, 1.05);
});

t('an empty first answer from getVoices is not kept', () => {
  const list = [];
  const { sb, said } = speaker(list);
  sb.coachSpeak('Off the trail');
  assert.equal(said[0].voice, undefined);
  list.push(...IOS);                        // the voices load a moment later
  sb.coachSpeak('Off the trail');
  assert.equal(said[1].voice.name, 'Serena');
  assert.equal(sb.voiceCache.list.length, IOS.length);
});

/** paintCoachVoice, lifted out, against fake elements. */
function painter(list, { chosen = null, all = false, speech = true, ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', imperial = false } = {}) {
  const els = {};
  const $ = (id) => (els[id] ??= { id, hidden: false, innerHTML: '', textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const speechSynthesis = { getVoices: () => list };
  const window = speech ? { speechSynthesis } : {};
  const sb = {
    $, window, speechSynthesis, navigator: { language: 'en-GB', userAgent: ua, maxTouchPoints: 5 },
    settings: { coachVoiceURI: chosen }, isNative: () => false, imp: () => imperial,
    esc: (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    rankVoices, voiceLabel, voiceName, voiceAccent, voiceHint, coachPhrase, SAMPLE_CALL,
  };
  vm.createContext(sb);
  vm.runInContext([line('const voiceCache = '), decl('function voiceList()'), line('const VOICES_SHOWN = '),
    line('const TICK = '), decl('function paintCoachVoice()'), `voiceCache.all = ${all}; paintCoachVoice();`].join('\n'), sb);
  const read = () => [...els.coachVoiceList?.innerHTML.matchAll(/data-voice="([^"]*)" aria-pressed="(true|false)"><span class="check-text"><b>([^<]*)<\/b><i>([^<]*)<\/i>/g) ?? []]
    .map(([, uri, on, name, sub]) => ({ uri, on: on === 'true', name, sub }));
  // What the 'voiceschanged' handler does, and the list as it is then.
  const again = () => { vm.runInContext('voiceCache.list = []; voiceList(); paintCoachVoice();', sb); return read(); };
  return { els, rows: read(), again };
}

t('the settings list: Automatic first, the best few, each with its quality', () => {
  const { els, rows } = painter(IOS);
  assert.deepEqual(rows.map(r => r.name), ['Automatic', 'Serena', 'Daniel', 'Daniel', 'Karen', 'Moira']);
  assert.equal(rows[0].sub, 'The best voice on this phone — Serena, Natural');
  assert.deepEqual(rows.slice(1).map(r => r.sub), ['British · Natural', 'British · Enhanced', 'British · Basic', 'Australian · Basic', 'Irish · Basic']);
  assert.deepEqual(rows.map(r => r.on), [true, false, false, false, false, false], 'Automatic is chosen');
  assert.equal(els.coachVoiceMore.hidden, false);
  assert.equal(els.coachVoiceMore.textContent, 'Show all 7 voices');
  assert.equal(els.coachVoiceMore.attrs['aria-expanded'], 'false');
  assert.equal(els.coachVoiceSample.textContent, '“Off the trail, 15 metres to the left”');
  assert.equal(els.coachVoiceHint.hidden, true, 'Serena is Premium: no hint');
  assert.equal(els.coachVoiceNone.hidden, true);
  assert.equal(els.coachVoiceBody.hidden, false);
});

t('the chosen voice is shown and pressed even past the cut, and all can be opened', () => {
  const sam = painter(IOS, { chosen: 'com.apple.voice.compact.en-US.Samantha' });
  assert.equal(sam.rows.length, 7);
  assert.deepEqual(sam.rows.filter(r => r.on).map(r => r.name), ['Samantha']);
  const all = painter(IOS, { all: true, imperial: true });
  assert.equal(all.rows.length, 8);
  assert.equal(all.els.coachVoiceMore.textContent, 'Show fewer voices');
  assert.equal(all.els.coachVoiceMore.attrs['aria-expanded'], 'true');
  assert.equal(all.els.coachVoiceSample.textContent, '“Off the trail, 50 feet to the left”');
  const stale = painter(IOS, { chosen: 'com.apple.voice.premium.en-GB.Malcolm' });
  assert.deepEqual(stale.rows.filter(r => r.on).map(r => r.name), ['Automatic'], 'a voice gone from the phone shows as Automatic');
});

t('a fresh iPhone gets the steps; Chrome gets them in general terms, and a note on signal', () => {
  const fresh = painter(IOS_FRESH);
  assert.equal(fresh.els.coachVoiceHint.hidden, false);
  assert.match(fresh.els.coachVoiceHint.textContent, /^For the most natural voice, download one on your iPhone: Settings → Accessibility/);
  assert.equal(fresh.els.coachVoiceMore.hidden, true, 'five voices: nothing to open');
  const chrome = painter(CHROME, { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128' });
  assert.ok(!/iPhone/.test(chrome.els.coachVoiceHint.textContent));
  assert.deepEqual(chrome.rows.at(-1), { uri: 'Google US English', on: false, name: 'Google US English', sub: 'American · Basic · needs a signal' });
});

t('no speech engine: the block says so and hides the rest', () => {
  const { els } = painter(IOS, { speech: false });
  assert.equal(els.coachVoiceNone.hidden, false);
  assert.equal(els.coachVoiceBody.hidden, true);
  assert.equal(els.coachVoiceList, undefined, 'nothing is drawn');
});

t('no voices yet: Automatic alone, and the list is drawn again when they come', () => {
  const list = [];
  const { els, rows, again } = painter(list);
  assert.deepEqual(rows.map(r => [r.name, r.sub, r.on]), [['Automatic', 'The best voice on this phone', true]]);
  assert.equal(els.coachVoiceMore.hidden, true);
  list.push(...IOS);
  assert.deepEqual(again().map(r => r.name), ['Automatic', 'Serena', 'Daniel', 'Daniel', 'Karen', 'Moira']);
  assert.equal(els.coachVoiceMore.hidden, false);
});

console.log(`\n${pass} passed total`);
