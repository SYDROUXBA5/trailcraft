/* The coach's voice. Left to itself an iPhone read the calls in its compact
   voice, and a handler in a field heard a satnav. So the coach names a
   voice: the best this phone holds, in English, never a joke voice, and
   never one that needs a signal ahead of one that does not.

   The choosing is pure and runs here on voice lists taken from real phones
   and browsers. The glue in app.js (the voice cache, the settings rows, the
   Play button) is read from the source, and coachSpeak and the painter are
   lifted out and run against small fakes of the page and the speech engine.
   In the iPhone app the coach speaks through iOS itself (native.js, the
   Speech plugin): its voices are mapped to the browser's shape and go
   through the very same ranking. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  rankVoices, pickVoice, voiceQuality, voiceLabel, voiceRate, voiceName, voiceAccent, voiceHint, speaksThroughWebKit,
  coachLang, speechLang, coachPhrase, SAMPLE_CALL, COACH_DEFAULTS, fromNativeVoice, NATIVE_PREMIUM, MAC_PREMIUM,
} from '../public/coach.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };
const ta = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

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

/* A Mac with Serena Premium and Daniel Enhanced downloaded, as a browser
   other than Safari lists it: the compact voices it ships with, the
   novelty voices, the Eloquence set and other languages come back from
   getVoices() too. No WebKit list looks like this (see WEBKIT below). */
const DOWNLOADED = [
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

/* What WebKit gives a page: Safari, the iPhone app's web view, and every
   browser on an iPhone. WebKit passes on only the voices the system came
   with (AVSpeechSynthesisVoice.isSystemVoice) and marks them all local, so
   a Premium or Enhanced voice downloaded in Settings never appears, nor
   does the Eloquence set. Taken from a Mac on macOS 26: compact Daniel,
   the "super-compact" voices, the novelty voices under their display
   names (Deranged is Wobble, Hysterical is Jester, Princess is Superstar),
   and other languages. */
const WEBKIT = [
  V('Daniel', 'en-GB', 'com.apple.voice.compact.en-GB.Daniel'),
  V('Karen', 'en-AU', 'com.apple.voice.super-compact.en-AU.Karen'),
  V('Moira', 'en-IE', 'com.apple.voice.super-compact.en-IE.Moira'),
  V('Rishi', 'en-IN', 'com.apple.voice.super-compact.en-IN.Rishi'),
  V('Samantha', 'en-US', 'com.apple.voice.super-compact.en-US.Samantha', { default: true }),
  V('Tessa', 'en-ZA', 'com.apple.voice.super-compact.en-ZA.Tessa'),
  ...['Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Cellos', 'Wobble', 'Fred', 'Good News', 'Jester',
    'Junior', 'Kathy', 'Organ', 'Superstar', 'Ralph', 'Trinoids', 'Whisper', 'Zarvox']
    .map(n => V(n, 'en-US', `com.apple.speech.synthesis.voice.${n.replace(/\s/g, '')}`)),
  V('Thomas', 'fr-FR', 'com.apple.voice.compact.fr-FR.Thomas'),
  V('Anna', 'de-DE', 'com.apple.voice.compact.de-DE.Anna'),
];

/* What an iPhone on iOS 16 to 18 can hand a page instead, as Apple's
   developer forums report: of English, only the Eloquence set and the
   novelty voices, none of which the coach will use, and the phone's own
   language beside them. The system still holds an English voice, and picks
   it when asked for English by language. */
const IPHONE_ELOQUENCE = [
  ...['Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley'].flatMap(n => [
    V(`${n} (English (UK))`, 'en-GB', `com.apple.eloquence.en-GB.${n}`),
    V(`${n} (English (US))`, 'en-US', `com.apple.eloquence.en-US.${n}`),
  ]),
  ...['Albert', 'Bad News', 'Bahh', 'Bells', 'Boing', 'Bubbles', 'Jester', 'Superstar', 'Zarvox']
    .map(n => V(n, 'en-US', `com.apple.speech.synthesis.voice.${n.replace(/\s/g, '')}`)),
  V('Thomas', 'fr-FR', 'com.apple.voice.compact.fr-FR.Thomas'),
];

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MAC_CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/* Chrome on a Mac: "(Enhanced)" and "(Premium)" in the names, Alex (a
   good plain voice), and the novelty voices under their Mac names. */
const MAC_CHROME = [
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

/* Edge on Windows: the machine's own voices, and Microsoft's neural ones,
   named "(Natural)" and spoken on Microsoft's servers. */
const EDGE = [
  V('Microsoft Hazel - English (United Kingdom)', 'en-GB', 'Microsoft Hazel - English (United Kingdom)', { default: true }),
  V('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB', 'Microsoft Sonia Online (Natural) - English (United Kingdom)', { localService: false }),
  V('Microsoft Aria Online (Natural) - English (United States)', 'en-US', 'Microsoft Aria Online (Natural) - English (United States)', { localService: false }),
  V('Microsoft Denise Online (Natural) - French (France)', 'fr-FR', 'Microsoft Denise Online (Natural) - French (France)', { localService: false }),
];

/* An iPhone on iOS 18 as the app's own engine describes it
   (AVSpeechSynthesisVoice): every voice on the phone, with the quality iOS
   gives it and whether iOS calls it a novelty. Serena and Zoe were
   downloaded as Premium, Daniel as Enhanced, and Moira is an old Enhanced
   voice from before Premium existed. Princess is a novelty voice under a
   name no list of jokes would know; iOS says what it is. */
const N = (identifier, name, language, quality = 'default', novelty = false) => ({ identifier, name, language, quality, novelty });
const IOS_APP = [
  N('com.apple.voice.compact.en-GB.Daniel', 'Daniel', 'en-GB'),
  N('com.apple.voice.compact.en-US.Samantha', 'Samantha', 'en-US'),
  N('com.apple.voice.compact.en-AU.Karen', 'Karen', 'en-AU'),
  N('com.apple.voice.enhanced.en-GB.Daniel', 'Daniel', 'en-GB', 'enhanced'),
  N('com.apple.voice.premium.en-GB.Serena', 'Serena', 'en-GB', 'premium'),
  N('com.apple.voice.premium.en-US.Zoe', 'Zoe', 'en-US', 'premium'),
  N('com.apple.ttsbundle.Moira-premium', 'Moira', 'en-IE', 'enhanced'),
  N('com.apple.speech.synthesis.voice.Trinoids', 'Trinoids', 'en-US', 'default', true),
  N('com.apple.speech.synthesis.voice.Princess', 'Princess', 'en-US', 'default', true),
  N('com.apple.eloquence.en-GB.Eddy', 'Eddy', 'en-GB'),
  N('com.apple.voice.premium.fr-FR.Thomas', 'Thomas', 'fr-FR', 'premium'),
];
/* The same phone before anything was downloaded. */
const IOS_APP_BARE = IOS_APP.filter(v => v.quality === 'default');

const uris = (ranked) => ranked.map(r => r.voice.voiceURI);
/** What the page handed over, as plain data: objects made in the lifted code are of another realm. */
const plain = (x) => JSON.parse(JSON.stringify(x));

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

t('downloaded voices: Premium, then Enhanced, then the compact voices; no joke voices, no other languages', () => {
  const r = rankVoices(DOWNLOADED, 'en-GB');
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
  assert.equal(rankVoices(WEBKIT, 'en-AU')[0].voice.name, 'Karen');
  assert.equal(rankVoices(WEBKIT, 'en-US')[0].voice.name, 'Samantha');
  assert.equal(rankVoices(WEBKIT, 'fr-FR')[0].voice.name, 'Daniel');
  // …but a natural voice in another accent beats a compact one in their own.
  assert.equal(rankVoices(DOWNLOADED, 'en-AU')[0].voice.name, 'Serena');
});

t('with nothing to name, the coach asks for its English, spelt as the engines spell it', () => {
  assert.equal(speechLang('fr-FR'), 'en-GB', 'not the phone’s French');
  assert.equal(speechLang('en-AU'), 'en-AU');
  assert.equal(speechLang('en_us'), 'en-US');
  assert.equal(speechLang('en'), 'en-GB');
  assert.equal(speechLang(undefined), 'en-GB');
  // An iPhone that lists only the Eloquence and novelty voices: nothing the coach will name.
  assert.deepEqual(rankVoices(IPHONE_ELOQUENCE, 'fr-FR'), []);
  assert.equal(pickVoice(IPHONE_ELOQUENCE, 'fr-FR'), null);
  assert.equal(pickVoice(IPHONE_ELOQUENCE, 'en-GB', 'com.apple.eloquence.en-GB.Eddy'), null, 'not even when once chosen');
});

t('when no voice can be named, the hint says the phone’s default speaks, once the list is in', () => {
  const unnamed = 'This phone does not name a voice the coach can use, so the calls are spoken in its default voice. Press Play to hear it.';
  const apple = 'Apple does not let this app use voices downloaded in Settings, so the coach speaks in the ones built in.';
  assert.equal(voiceHint(IPHONE_ELOQUENCE, 'fr-FR', { webkit: true }), `${unnamed} ${apple}`, 'listed, so no wait is needed');
  assert.equal(voiceHint([], 'en-GB', { webkit: true, settled: true }), `${unnamed} ${apple}`);
  assert.equal(voiceHint([], 'en-GB', { settled: true }), unnamed);
  assert.equal(voiceHint([], 'en-GB', { webkit: true }), apple, 'while the voices may still be coming, no note');
  assert.equal(voiceHint([], 'en-GB'), '');
  assert.equal(voiceHint(WEBKIT, 'en-GB', { webkit: true, settled: true }), apple, 'a voice to name: no note');
});

t('a Mac outside Safari: names say the quality, Alex stays, the organ does not', () => {
  const r = rankVoices(MAC_CHROME, 'en-GB');
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
  assert.equal(pickVoice(DOWNLOADED, 'en-GB').voiceURI, 'com.apple.voice.premium.en-GB.Serena', 'Automatic is the best');
  assert.equal(pickVoice(DOWNLOADED, 'en-GB', 'com.apple.voice.compact.en-IE.Moira').voiceURI, 'com.apple.voice.compact.en-IE.Moira');
  assert.equal(pickVoice(DOWNLOADED, 'en-GB', 'com.apple.voice.premium.en-GB.Malcolm').voiceURI,
    'com.apple.voice.premium.en-GB.Serena', 'a voice deleted since it was chosen: the best one left');
  assert.equal(pickVoice(DOWNLOADED, 'en-GB', 'com.apple.speech.synthesis.voice.Zarvox').voiceURI,
    'com.apple.voice.premium.en-GB.Serena', 'a joke voice is never used, even when stored');
  assert.equal(pickVoice(DOWNLOADED, 'en-GB', 'com.apple.voice.compact.fr-FR.Thomas').voiceURI,
    'com.apple.voice.premium.en-GB.Serena', 'nor one that cannot say the English');
  assert.equal(pickVoice([], 'en-GB'), null, 'no voices yet: the browser picks, as it always did');
  assert.equal(pickVoice([], 'en-GB', 'com.apple.voice.premium.en-GB.Serena'), null);
  assert.equal(pickVoice(undefined, 'en-GB'), null);
  assert.equal(pickVoice(DOWNLOADED.filter(v => !v.lang.startsWith('en')), 'fr-FR'), null, 'no English voice at all');
  assert.deepEqual(rankVoices([], 'en-GB'), []);
});

t('WebKit: only the voices built in, so the coach says so and never sends the handler to download one', () => {
  const r = rankVoices(WEBKIT, 'en-GB');
  assert.deepEqual(r.map(x => x.voice.name), ['Daniel', 'Karen', 'Moira', 'Rishi', 'Samantha', 'Tessa'], 'no novelty voice, no other language');
  assert.ok(r.every(x => x.quality === 'compact' && x.known && x.local));
  assert.equal(pickVoice(WEBKIT, 'en-GB').voiceURI, 'com.apple.voice.compact.en-GB.Daniel');
  assert.equal(pickVoice(WEBKIT, 'en-US').voiceURI, 'com.apple.voice.super-compact.en-US.Samantha');
  const said = voiceHint(WEBKIT, 'en-GB', { webkit: true });
  assert.equal(said, 'Apple does not let this app use voices downloaded in Settings, so the coach speaks in the ones built in.');
  assert.ok(!/download (one|an)|marked Premium|iPhone|iPad/.test(said), 'no steps that could never work');
  assert.equal(voiceHint([], 'en-GB', { webkit: true }), said);
  assert.equal(voiceHint(DOWNLOADED, 'en-GB', { webkit: true }), '', 'should WebKit ever pass a Premium voice on, nothing to say');
});

t('which pages speak through WebKit', () => {
  const MAC_SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
  assert.equal(speaksThroughWebKit(IPHONE_UA), true);
  assert.equal(speaksThroughWebKit('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1'), true, 'Chrome on an iPhone is WebKit too');
  assert.equal(speaksThroughWebKit(MAC_SAFARI_UA), true, 'Safari on a Mac');
  assert.equal(speaksThroughWebKit(MAC_SAFARI_UA, { touches: 5 }), true, 'an iPad asking for the desktop site');
  assert.equal(speaksThroughWebKit('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0', { touches: 5 }), true, 'a touch screen that says Macintosh is an iPad, whatever the browser');
  assert.equal(speaksThroughWebKit('', { native: true }), true, 'the iPhone app');
  assert.equal(speaksThroughWebKit(MAC_CHROME_UA), false);
  assert.equal(speaksThroughWebKit('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0'), false);
  assert.equal(speaksThroughWebKit('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0'), false);
  assert.equal(speaksThroughWebKit('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36', { touches: 5 }), false);
  assert.equal(speaksThroughWebKit(undefined), false);
});

t('off Apple the hint is given only where it can be acted on, and names no device', () => {
  assert.equal(voiceHint(ANDROID, 'en-GB'), '', 'Android’s voices cannot be told apart by quality: no hint that could never clear');
  assert.equal(voiceHint(EDGE, 'en-GB'), '');
  assert.equal(voiceHint(CHROME, 'en-GB'), '');
  assert.equal(voiceHint([], 'en-GB'), '');
  const mac = voiceHint(MAC_CHROME.filter(v => !/premium/i.test(v.name)), 'en-GB');
  assert.equal(mac, MAC_PREMIUM, 'a Mac outside Safari can download one, and a Premium voice then clears it');
  /* Read & Speak since macOS 26, Spoken Content before it; and the voice is
     marked Premium in Settings but Natural here. */
  assert.equal(mac, 'For the most natural voice, download an English voice marked Premium in System Settings → Accessibility → Read & Speak (called Spoken Content before macOS 26). It shows up here marked Natural.');
  assert.equal(voiceHint(MAC_CHROME, 'en-GB'), '');
  assert.equal(voiceHint(DOWNLOADED.filter(v => !/premium/.test(v.voiceURI)), 'en-GB'), mac);
  for (const list of [WEBKIT, DOWNLOADED, MAC_CHROME, CHROME, ANDROID, EDGE, []]) {
    for (const webkit of [true, false]) assert.ok(!/iPhone|iPad/.test(voiceHint(list, 'en-GB', { webkit })), 'an iPad is not an iPhone');
  }
});

t('a quality that cannot be read is not called Basic', () => {
  assert.deepEqual(rankVoices(ANDROID, 'en-GB').map(r => r.known), [false, false, false, false]);
  assert.deepEqual(rankVoices(CHROME, 'en-GB').map(r => r.known), [false, false, false, false, false]);
  assert.ok(rankVoices(DOWNLOADED, 'en-GB').every(r => r.known), 'Apple names every voice by its quality');
  assert.equal(rankVoices([V('Alex', 'en-US', 'com.apple.speech.synthesis.voice.Alex')], 'en-GB')[0].known, true, 'an Apple voice with no mark is a plain one');
});

t('Microsoft’s "(Natural)" voices are Enhanced, and the name drops the word', () => {
  const sonia = EDGE[1];
  assert.equal(voiceQuality(sonia), 'enhanced');
  assert.equal(voiceRate(voiceQuality(sonia)), 1);
  assert.equal(voiceName(sonia), 'Microsoft Sonia Online - English (United Kingdom)', 'the app’s “Natural” is Apple’s Premium, so one row never says both');
  const r = rankVoices(EDGE, 'en-GB');
  assert.deepEqual(r.map(x => [x.voice.name.split(' ')[1], x.quality, x.known, x.local]),
    [['Hazel', 'plain', false, true], ['Sonia', 'enhanced', true, false], ['Aria', 'enhanced', true, false]],
    'the voice on the machine still comes before the one that needs a signal');
});

/* ── The iPhone app's own voice ────────────────────────────────────── */

t('in the app a voice is taken as iOS describes it: quality as said, all on the phone', () => {
  assert.deepEqual(fromNativeVoice(N('com.apple.voice.premium.en-GB.Serena', 'Serena', 'en-GB', 'premium')),
    { voiceURI: 'com.apple.voice.premium.en-GB.Serena', name: 'Serena', lang: 'en-GB', localService: true, default: false, quality: 'premium', novelty: false });
  const q = (v) => voiceQuality(fromNativeVoice(v));
  assert.equal(q(N('com.apple.voice.enhanced.en-GB.Daniel', 'Daniel', 'en-GB', 'enhanced')), 'enhanced');
  assert.equal(q(N('com.apple.voice.compact.en-GB.Daniel', 'Daniel', 'en-GB')), 'compact', 'iOS calls it default: the identifier says compact');
  assert.equal(q(N('com.apple.voice.super-compact.en-AU.Karen', 'Karen', 'en-AU')), 'compact');
  assert.equal(q(N('com.apple.speech.synthesis.voice.Fred', 'Fred', 'en-US')), 'plain');
  // Taken as said, not read from the name: an odd name cannot promote or demote it.
  assert.equal(q(N('com.apple.ttsbundle.Moira-premium', 'Moira', 'en-IE', 'enhanced')), 'enhanced');
  assert.equal(q(N('com.apple.voice.x.en-GB.Premium', 'Premium', 'en-GB', 'default')), 'plain');
  assert.equal(q(N('com.apple.voice.compact.en-GB.Kate', 'Kate', 'en-GB', 'premium')), 'premium');
  assert.equal(fromNativeVoice(N('a', 'b', 'en-GB', 'default', true)).novelty, true);
  assert.equal(fromNativeVoice({}).voiceURI, '', 'a voice with nothing to say is not a crash');
  // A browser's voice has no quality of its own, and is read as it always was.
  assert.equal(voiceQuality({ voiceURI: 'com.apple.voice.premium.en-GB.Serena', name: 'Serena' }), 'premium');
});

t('in the app the same ranking: Premium, Enhanced, compact; English only; no joke voice, even one iOS names oddly', () => {
  const ranked = rankVoices(IOS_APP.map(fromNativeVoice), 'en-GB');
  assert.deepEqual(uris(ranked), [
    'com.apple.voice.premium.en-GB.Serena',
    'com.apple.voice.premium.en-US.Zoe',
    'com.apple.voice.enhanced.en-GB.Daniel',
    'com.apple.ttsbundle.Moira-premium',
    'com.apple.voice.compact.en-GB.Daniel',
    'com.apple.voice.compact.en-AU.Karen',
    'com.apple.voice.compact.en-US.Samantha',
  ]);
  assert.ok(ranked.every(r => r.known && r.local), 'iOS said the quality, and every voice is on the phone');
  assert.equal(pickVoice(IOS_APP.map(fromNativeVoice), 'en-US').voiceURI, 'com.apple.voice.premium.en-US.Zoe', 'the handler’s own English among equals');
  // The choice is kept in coachVoiceURI as iOS's identifier, which is also what WebKit called it.
  assert.equal(pickVoice(IOS_APP.map(fromNativeVoice), 'en-GB', 'com.apple.voice.compact.en-AU.Karen').name, 'Karen');
  assert.equal(pickVoice(IOS_APP.map(fromNativeVoice), 'en-GB', 'com.apple.speech.synthesis.voice.Princess').name, 'Serena', 'a joke voice is never taken, even chosen');
});

t('in the app the hint gives the way to a Premium voice, and goes once one is here', () => {
  const bare = IOS_APP_BARE.map(fromNativeVoice);
  assert.equal(voiceHint(bare, 'en-GB', { native: true }), NATIVE_PREMIUM);
  /* iOS 26 renamed Spoken Content to Read & Speak, so the menu the hint named
     was not there on a current iPhone; a phone not yet updated still has the
     old name. Premium is Settings' word for it, Natural is this app's. */
  assert.match(NATIVE_PREMIUM, /download an English voice marked Premium: open Settings, then Accessibility → Read & Speak \(called Spoken Content on older versions\) → Voices → English\./);
  assert.match(NATIVE_PREMIUM, /shows up here, marked Natural\.$/);
  assert.equal(voiceLabel('premium'), 'Natural', 'which is what the app calls it');
  assert.ok(!/Apple does not let/.test(voiceHint(bare, 'en-GB', { native: true })), 'in the app a downloaded voice does reach the coach');
  assert.ok(!/iPhone|iPad/.test(NATIVE_PREMIUM), 'the steps are the same on an iPad');
  assert.equal(voiceHint(IOS_APP.map(fromNativeVoice), 'en-GB', { native: true }), '', 'a Premium voice is here: nothing to say');
  assert.equal(voiceHint([], 'en-GB', { native: true, settled: true }),
    `This phone does not name a voice the coach can use, so the calls are spoken in its default voice. Press Play to hear it. ${NATIVE_PREMIUM}`);
  // Safari on an iPhone is still WebKit, and is still told the truth about it.
  assert.equal(voiceHint(WEBKIT, 'en-GB', { webkit: true }), 'Apple does not let this app use voices downloaded in Settings, so the coach speaks in the ones built in.');
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
  assert.match(f, /row\('', 'Automatic', `\$\{webkit \? 'The best built-in voice' : 'The best voice on this phone'\}/,
    'under WebKit Automatic is the best voice built in, not the best on the phone');
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
  assert.match(w, /const fresh = \(\) => \{\s*voiceCache\.list = \[\];\s*voiceCache\.settled = true;\s*voiceList\(\);\s*const at = document\.activeElement;\s*if \(at\) repaintFrom\(at, paintCoachVoice\); else paintCoachVoice\(\);/);
  assert.match(w, /voiceList\(\);   \/\/ Chrome only starts[\s\S]{0,400}setTimeout\(fresh, 3000\);/, 'an engine that never says so is settled after a grace');
  assert.match(decl('function voiceList()'), /if \(!voiceCache\.list\.length && 'speechSynthesis' in window\)/, 'an empty list is asked for again');
});

t('tapping a voice keeps it, and Play says the sample call in it', () => {
  const w = decl('function wire()');
  const click = w.slice(w.indexOf("$('coachVoiceBox').addEventListener('click'"));
  assert.match(click, /settings\.coachVoiceURI = row\.dataset\.voice \|\| null;\s*saveSettings\(\);\s*return repaintFrom\(row, paintCoachVoice\);/);
  assert.match(click, /voiceCache\.all = !voiceCache\.all;\s*paintCoachVoice\(\);[\s\S]{0,300}if \(!voiceCache\.all\) \$\('coachVoiceMore'\)\.scrollIntoView\(\{ block: 'nearest' \}\);/,
    'folding the list from its foot brings the button back into view, with no glide');
  assert.match(click, /if \(e\.target\.closest\('#coachVoicePlay'\)\) coachSpeak\(coachPhrase\(SAMPLE_CALL, \{ imperial: imp\(\) \}\)\);/);
  // The priming on the first touch is untouched: it still speaks a silent space.
  assert.match(decl('function audioUnlock()'), /const u = new SpeechSynthesisUtterance\(' '\);\s*u\.volume = 0;\s*speechSynthesis\.speak\(u\);/);
  assert.match(w, /document\.addEventListener\('pointerdown', audioUnlock, \{ once: true \}\);/);
});

/* ── Run for real ──────────────────────────────────────────────────── */

/** coachSpeak and the voice cache, lifted out, with a fake speech engine.
    With `ios`, the app speaks through a fake of iOS holding those voices,
    which takes a call (or refuses it, with `refuse`). */
function speaker(list, { lang = 'en-GB', chosen = null, ios = null, refuse = false } = {}) {
  const said = [], told = [];
  const speechSynthesis = { getVoices: () => list, cancel() {}, speak: (u) => said.push(u) };
  const sb = {
    window: {}, navigator: { language: lang }, speechSynthesis, settings: { coachVoiceURI: chosen },
    pickVoice, voiceRate, voiceQuality, speechLang, fromNativeVoice,
    speakNative: async (o) => { told.push(o); return !refuse; },
    SpeechSynthesisUtterance: function (text) { this.text = text; },
  };
  sb.window.speechSynthesis = speechSynthesis;
  sb.IOS = ios;
  vm.createContext(sb);
  vm.runInContext([line('const voiceCache = '), decl('function voiceList()'), decl('function coachSpeak(text, '), decl('function webSpeak(text)'),
    'if (IOS) { voiceCache.native = true; voiceCache.list = IOS.map(fromNativeVoice); }',
    'this.coachSpeak = coachSpeak; this.voiceCache = voiceCache;'].join('\n'), sb);
  return { sb, said, told };
}

t('coachSpeak names the voice, and paces it by its quality', () => {
  const { sb, said } = speaker(DOWNLOADED);
  sb.coachSpeak('Back on the trail');
  assert.equal(said.length, 1);
  assert.equal(said[0].voice.voiceURI, 'com.apple.voice.premium.en-GB.Serena');
  assert.equal(said[0].lang, 'en-GB', 'the voice’s own language, so the engine does not swap it');
  assert.equal(said[0].rate, 1);
  const moira = speaker(DOWNLOADED, { chosen: 'com.apple.voice.compact.en-IE.Moira' });
  moira.sb.coachSpeak('Still off');
  assert.equal(moira.said[0].voice.name, 'Moira');
  assert.equal(moira.said[0].lang, 'en-IE');
  assert.equal(moira.said[0].rate, 1.05);
});

t('with no voice to name, coachSpeak asks for English, never the phone’s own language', () => {
  for (const list of [[], IPHONE_ELOQUENCE]) {
    const { sb, said } = speaker(list, { lang: 'fr-FR' });
    sb.coachSpeak('Off the trail, 15 metres to the left');
    assert.equal(said.length, 1, 'still spoken');
    assert.equal(said[0].voice, undefined, 'the phone picks the voice');
    assert.equal(said[0].lang, 'en-GB', 'an English one: a French voice reading the call is the robot this was meant to end');
    assert.equal(said[0].rate, 1.05);
  }
  const aussie = speaker(IPHONE_ELOQUENCE, { lang: 'en-AU' });
  aussie.sb.coachSpeak('Off the trail');
  assert.equal(aussie.said[0].lang, 'en-AU', 'the handler’s own English where it is English');
});

t('a named voice that fails is said again in the browser’s own, once; a call cut short is not', () => {
  // A French phone with no local English voice: Automatic is a network one.
  const list = [
    V('Microsoft Hortense - French (France)', 'fr-FR', 'Microsoft Hortense - French (France)'),
    V('Google français', 'fr-FR', 'Google français', { localService: false }),
    V('Google UK English Female', 'en-GB', 'Google UK English Female', { localService: false }),
  ];
  for (const error of ['network', 'synthesis-failed', 'voice-unavailable']) {
    const { sb, said } = speaker(list, { lang: 'fr-FR' });
    sb.coachSpeak('Off the trail, 15 metres to the left');
    assert.equal(said[0].voice.name, 'Google UK English Female');
    assert.equal(typeof said[0].onerror, 'function', 'a named voice has a way back');
    said[0].onerror({ error });
    assert.equal(said.length, 2, `${error}: said again`);
    assert.equal(said[1].text, 'Off the trail, 15 metres to the left');
    assert.equal(said[1].voice, undefined, 'in the browser’s own voice');
    assert.equal(said[1].lang, 'fr-FR', 'the voice needed a signal: asking for English could land on it again, and the French one is on the phone');
    assert.equal(said[1].rate, 1.05);
    assert.equal(said[1].onerror, undefined, 'once, never round and round');
  }
  for (const error of ['interrupted', 'canceled']) {
    const { sb, said } = speaker(list, { lang: 'fr-FR' });
    sb.coachSpeak('Still off');
    said[0].onerror({ error });
    assert.equal(said.length, 1, `${error}: the next call took over, so this one is not said again`);
  }
});

t('a voice on the phone that fails is said again in English, not the phone’s own language', () => {
  // A French iPhone: Daniel is named, and fails; the signal was never the trouble.
  const { sb, said } = speaker(WEBKIT, { lang: 'fr-FR' });
  sb.coachSpeak('Off the trail, 15 metres to the left');
  assert.equal(said[0].voice.name, 'Daniel');
  said[0].onerror({ error: 'synthesis-failed' });
  assert.equal(said.length, 2);
  assert.equal(said[1].voice, undefined, 'in the phone’s own choice of voice');
  assert.equal(said[1].lang, 'en-GB', 'but an English one');
  assert.equal(said[1].onerror, undefined, 'once');
});

t('an empty first answer from getVoices is not kept', () => {
  const list = [];
  const { sb, said } = speaker(list);
  sb.coachSpeak('Off the trail');
  assert.equal(said[0].voice, undefined);
  list.push(...DOWNLOADED);                        // the voices load a moment later
  sb.coachSpeak('Off the trail');
  assert.equal(said[1].voice.name, 'Serena');
  assert.equal(sb.voiceCache.list.length, DOWNLOADED.length);
});

await ta('in the app coachSpeak hands iOS the voice by name, at its pace, and leaves the web engine alone', async () => {
  const { sb, said, told } = speaker(WEBKIT, { ios: IOS_APP });
  sb.coachSpeak('Off the trail, 15 metres to the left');
  assert.deepEqual(plain(told), [{ text: 'Off the trail, 15 metres to the left', voice: 'com.apple.voice.premium.en-GB.Serena', lang: 'en-GB', rate: 1 }]);
  assert.equal(said.length, 0, 'the web view says nothing');
  const karen = speaker([], { ios: IOS_APP, chosen: 'com.apple.voice.compact.en-AU.Karen' });
  karen.sb.coachSpeak('Still off');
  assert.deepEqual(plain(karen.told[0]), { text: 'Still off', voice: 'com.apple.voice.compact.en-AU.Karen', lang: 'en-AU', rate: 1.05 });
  // No English voice to name: iOS is asked for the coach's English, not the phone's language.
  const french = speaker([], { ios: [N('com.apple.voice.compact.fr-FR.Thomas', 'Thomas', 'fr-FR')], lang: 'fr-FR' });
  french.sb.coachSpeak('Off the trail');
  assert.deepEqual(plain(french.told[0]), { text: 'Off the trail', lang: 'en-GB', rate: 1.05 });
  await new Promise(r => setImmediate(r));
  assert.equal(sb.voiceCache.native, true, 'iOS took it: the app keeps its own voice');
});

await ta('should iOS refuse a call, the web view says it, and speaks from then on', async () => {
  const { sb, said, told } = speaker(WEBKIT, { ios: IOS_APP, refuse: true });
  sb.coachSpeak('Back on the trail');
  assert.equal(told.length, 1);
  await new Promise(r => setImmediate(r));
  assert.equal(said.length, 1, 'said, not lost');
  assert.equal(said[0].text, 'Back on the trail');
  assert.equal(said[0].voice.voiceURI, 'com.apple.voice.compact.en-GB.Daniel', 'in a voice the web engine has, not one of iOS’s');
  assert.equal(sb.voiceCache.native, false);
  sb.coachSpeak('Still off');
  assert.equal(told.length, 1, 'iOS is not asked again');
  assert.equal(said.length, 2);
});

await ta('in the app the voices are iOS’s, taken again when the app comes back and when one downloads', () => {
  const w = decl('function wire()');
  assert.match(w, /if \(canSpeakNative\(\)\) \{\s*voiceCache\.native = true;\s*nativeVoicesFresh\(\);\s*watchNativeVoices\(nativeVoicesFresh\);/);
  assert.match(w, /document\.addEventListener\('visibilitychange', \(\) => \{\s*if \(document\.visibilityState === 'visible' && voiceCache\.native\) nativeVoicesFresh\(\);/,
    'back from Settings with a Premium voice, it is in the list');
  assert.match(w, /\} else if \('speechSynthesis' in window\) \{/, 'the web view’s own list never overwrites iOS’s');
  assert.match(decl('function voiceList()'), /^function voiceList\(\) \{\n {2}if \(voiceCache\.native\) return voiceCache\.list;/);
  // Run: the list comes from iOS, mapped, and the choice is drawn again.
  const painted = [];
  const sb = {
    voiceCache: { list: [], settled: false, native: true }, fromNativeVoice,
    nativeVoices: async () => IOS_APP, document: { activeElement: null },
    paintCoachVoice: () => painted.push(sb.voiceCache.list.length), repaintFrom: () => {},
  };
  vm.createContext(sb);
  vm.runInContext(decl('async function nativeVoicesFresh()'), sb);
  return sb.nativeVoicesFresh().then(() => {
    assert.equal(sb.voiceCache.list.length, IOS_APP.length);
    assert.equal(sb.voiceCache.list[4].quality, 'premium');
    assert.equal(sb.voiceCache.settled, true);
    assert.deepEqual(painted, [IOS_APP.length]);
  });
});

/** paintCoachVoice, lifted out, against fake elements. */
function painter(list, { chosen = null, all = false, settled = false, speech = true, ua = MAC_CHROME_UA, touches = 0, native = false, imperial = false, ios = null } = {}) {
  const els = {};
  const $ = (id) => (els[id] ??= { id, hidden: false, innerHTML: '', textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const speechSynthesis = { getVoices: () => list };
  const window = speech ? { speechSynthesis } : {};
  const sb = {
    $, window, speechSynthesis, navigator: { language: 'en-GB', userAgent: ua, maxTouchPoints: touches },
    settings: { coachVoiceURI: chosen }, isNative: () => native, imp: () => imperial,
    esc: (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    rankVoices, voiceLabel, voiceName, voiceAccent, voiceHint, speaksThroughWebKit, coachPhrase, SAMPLE_CALL,
    fromNativeVoice, IOS: ios,
  };
  vm.createContext(sb);
  vm.runInContext([line('const voiceCache = '), decl('function voiceList()'), line('const VOICES_SHOWN = '),
    line('const TICK = '), decl('function paintCoachVoice()'),
    'if (IOS) { voiceCache.native = true; voiceCache.list = IOS.map(fromNativeVoice); }',
    `voiceCache.all = ${all}; voiceCache.settled = ${settled}; paintCoachVoice();`].join('\n'), sb);
  const read = () => [...els.coachVoiceList?.innerHTML.matchAll(/data-voice="([^"]*)" aria-pressed="(true|false)"><span class="check-text"><b>([^<]*)<\/b><i>([^<]*)<\/i>/g) ?? []]
    .map(([, uri, on, name, sub]) => ({ uri, on: on === 'true', name, sub }));
  // What the 'voiceschanged' handler does, and the list as it is then.
  const again = () => { vm.runInContext('voiceCache.list = []; voiceList(); paintCoachVoice();', sb); return read(); };
  return { els, rows: read(), again };
}

t('the settings list: Automatic first, the best few, each with its quality', () => {
  const { els, rows } = painter(DOWNLOADED);
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
  const sam = painter(DOWNLOADED, { chosen: 'com.apple.voice.compact.en-US.Samantha' });
  assert.equal(sam.rows.length, 7);
  assert.deepEqual(sam.rows.filter(r => r.on).map(r => r.name), ['Samantha']);
  const all = painter(DOWNLOADED, { all: true, imperial: true });
  assert.equal(all.rows.length, 8);
  assert.equal(all.els.coachVoiceMore.textContent, 'Show fewer voices');
  assert.equal(all.els.coachVoiceMore.attrs['aria-expanded'], 'true');
  assert.equal(all.els.coachVoiceSample.textContent, '“Off the trail, 50 feet to the left”');
  const stale = painter(DOWNLOADED, { chosen: 'com.apple.voice.premium.en-GB.Malcolm' });
  assert.deepEqual(stale.rows.filter(r => r.on).map(r => r.name), ['Automatic'], 'a voice gone from the phone shows as Automatic');
});

t('an iPhone is told plainly that only the built-in voices can be used; Automatic says built in', () => {
  for (const opts of [{ ua: IPHONE_UA, touches: 5 }, { native: true, ua: IPHONE_UA, touches: 5 },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', touches: 5 }]) {
    const phone = painter(WEBKIT, opts);
    assert.equal(phone.rows[0].sub, 'The best built-in voice — Daniel, Basic');
    assert.deepEqual(phone.rows.slice(1).map(r => r.sub), ['British · Basic', 'Australian · Basic', 'Irish · Basic', 'Indian · Basic', 'American · Basic']);
    assert.equal(phone.els.coachVoiceHint.hidden, false);
    assert.equal(phone.els.coachVoiceHint.textContent, 'Apple does not let this app use voices downloaded in Settings, so the coach speaks in the ones built in.');
    assert.equal(phone.els.coachVoiceMore.hidden, false, 'six voices: the sixth is behind the button');
  }
});

t('off Apple: no quality guessed, no hint that could never clear, and a note on signal', () => {
  const chrome = painter(CHROME, { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' });
  assert.equal(chrome.els.coachVoiceHint.hidden, true);
  assert.equal(chrome.rows[0].sub, 'The best voice on this phone — Microsoft Hazel - English (United Kingdom)');
  assert.deepEqual(chrome.rows.at(-1), { uri: 'Google US English', on: false, name: 'Google US English', sub: 'American · needs a signal' });
  const android = painter(ANDROID, { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36', touches: 5 });
  assert.deepEqual(android.rows.map(r => r.sub), ['The best voice on this phone — English United Kingdom', 'British', 'Indian', 'American', 'British · needs a signal']);
  assert.equal(android.els.coachVoiceHint.hidden, true);
  const edge = painter(EDGE, { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0' });
  assert.deepEqual(edge.rows.slice(1).map(r => [r.name, r.sub]), [
    ['Microsoft Hazel - English (United Kingdom)', 'British'],
    ['Microsoft Sonia Online - English (United Kingdom)', 'British · Enhanced · needs a signal'],
    ['Microsoft Aria Online - English (United States)', 'American · Enhanced · needs a signal'],
  ]);
  assert.equal(edge.els.coachVoiceHint.hidden, true);
});

t('no speech engine: the block says so and hides the rest', () => {
  const { els } = painter(DOWNLOADED, { speech: false });
  assert.equal(els.coachVoiceNone.hidden, false);
  assert.equal(els.coachVoiceBody.hidden, true);
  assert.equal(els.coachVoiceList, undefined, 'nothing is drawn');
});

t('an empty voice list, once settled, is not called mute: the coach still speaks, and Play stays', () => {
  // Safari has answered getVoices() with nothing and spoken in a default voice all the same.
  for (const opts of [{ ua: IPHONE_UA, touches: 5, native: true }, {}]) {
    const empty = painter([], { settled: true, ...opts });
    assert.equal(empty.els.coachVoiceNone.hidden, true, 'coachSpeak speaks every call here, so the block does not say it cannot');
    assert.equal(empty.els.coachVoiceBody.hidden, false, 'Play is kept: it is how the handler hears the default');
    assert.deepEqual(empty.rows.map(r => [r.name, r.on]), [['Automatic', true]]);
    assert.equal(empty.els.coachVoiceHint.hidden, false);
    assert.match(empty.els.coachVoiceHint.textContent, /^This phone does not name a voice the coach can use, so the calls are spoken in its default voice\. Press Play to hear it\./);
  }
  const some = painter(DOWNLOADED, { settled: true });
  assert.equal(some.els.coachVoiceNone.hidden, true);
  assert.equal(some.els.coachVoiceBody.hidden, false);
});

t('an iPhone that lists only the Eloquence and novelty voices: Automatic, Play, and a plain note', () => {
  const phone = painter(IPHONE_ELOQUENCE, { ua: IPHONE_UA, touches: 5, native: true });
  assert.equal(phone.els.coachVoiceNone.hidden, true);
  assert.equal(phone.els.coachVoiceBody.hidden, false);
  assert.deepEqual(phone.rows.map(r => [r.name, r.sub, r.on]), [['Automatic', 'The best built-in voice', true]], 'no robot offered as a row');
  assert.equal(phone.els.coachVoiceMore.hidden, true);
  assert.equal(phone.els.coachVoiceHint.hidden, false);
  assert.equal(phone.els.coachVoiceHint.textContent,
    'This phone does not name a voice the coach can use, so the calls are spoken in its default voice. Press Play to hear it. Apple does not let this app use voices downloaded in Settings, so the coach speaks in the ones built in.');
});

t('in the app: every voice, downloaded ones first, and the way to a Premium one until there is one', () => {
  const opts = { native: true, ua: IPHONE_UA, touches: 5 };
  const phone = painter(WEBKIT, { ...opts, ios: IOS_APP });
  assert.equal(phone.rows[0].sub, 'The best voice on this phone — Serena, Natural', 'not "built in": the app has them all');
  assert.deepEqual(phone.rows.slice(1).map(r => [r.name, r.sub]), [
    ['Serena', 'British · Natural'], ['Zoe', 'American · Natural'], ['Daniel', 'British · Enhanced'],
    ['Moira', 'Irish · Enhanced'], ['Daniel', 'British · Basic'],
  ]);
  assert.equal(phone.els.coachVoiceHint.hidden, true, 'a Premium voice is here');
  const bare = painter(WEBKIT, { ...opts, ios: IOS_APP_BARE });
  assert.equal(bare.rows[0].sub, 'The best voice on this phone — Daniel, Basic');
  assert.equal(bare.els.coachVoiceHint.hidden, false);
  assert.equal(bare.els.coachVoiceHint.textContent, NATIVE_PREMIUM);
  assert.ok(!/Apple does not let/.test(bare.els.coachVoiceHint.textContent));
  // With the web engine gone from the page, the app still speaks, so the block is not called mute.
  const quiet = painter([], { ...opts, speech: false, ios: IOS_APP });
  assert.equal(quiet.els.coachVoiceNone.hidden, true);
  assert.equal(quiet.rows.length, 6);
});

t('no voices yet: Automatic alone, and the list is drawn again when they come', () => {
  const list = [];
  const { els, rows, again } = painter(list);
  assert.deepEqual(rows.map(r => [r.name, r.sub, r.on]), [['Automatic', 'The best voice on this phone', true]]);
  assert.equal(els.coachVoiceMore.hidden, true);
  list.push(...DOWNLOADED);
  assert.deepEqual(again().map(r => r.name), ['Automatic', 'Serena', 'Daniel', 'Daniel', 'Karen', 'Moira']);
  assert.equal(els.coachVoiceMore.hidden, false);
});

console.log(`\n${pass} passed total`);
