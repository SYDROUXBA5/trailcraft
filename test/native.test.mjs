/* Files out of the iPhone app (native.js shareFile).

   Inside the app a download link does nothing and says nothing: the web view
   hands a blob: link to the system and cancels it. So "Export everything"
   was a dead button there, and so were Save GPX and the PDF wherever the web
   view offered no share sheet for files. The file now goes through
   Capacitor's own Filesystem and Share plugins. Here the plugins are fakes
   that record what they were asked.

   The coach's voice in the iPhone app (native.js speakNative and friends)
   is iOS's own, from the Speech plugin in ios/App/App/TrailcraftSpeech.swift:
   the web view's speech lists only the voices the phone came with and is
   silent with the screen dark. The JavaScript runs against a fake plugin;
   the Swift side, the plist and the Xcode project are read for their
   wiring. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shareFile, shareBlob, keepAwake, isNative, canSpeakNative, nativeVoices, speakNative, stopNativeSpeech, watchNativeVoices } from '../public/native.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

/** A shell with the two plugins, each keeping what it was handed. */
function shell({ shareFails = null, writeFails = false, appendFails = false, plugins = ['Filesystem', 'Share'] } = {}) {
  const seen = { writes: [], shares: [], appends: [], cleared: [] };
  const all = {
    Filesystem: {
      async writeFile(o) {
        if (writeFails) throw new Error('disk');
        seen.writes.push(o);
        return { uri: `file:///cache/${o.path}` };
      },
      /* A video is written a piece at a time (shareBlob), into a folder emptied first. */
      async appendFile(o) { if (appendFails) throw new Error('disk'); seen.appends.push(o); },
      async rmdir(o) { seen.cleared.push(o); if (!seen.writes.length) throw new Error('no such folder'); },
    },
    Share: {
      async share(o) {
        if (shareFails) throw new Error(shareFails);
        seen.shares.push(o);
        return {};
      },
    },
  };
  const Plugins = Object.fromEntries(plugins.map(p => [p, all[p]]));
  globalThis.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins } };
  return seen;
}

await t('in a browser there is no shell, and nothing is attempted', async () => {
  globalThis.window = {};
  assert.equal(isNative(), false);
  assert.equal(await shareFile('{}', 'x.json'), 'none');
});

await t('text goes to the cache folder as text, then to the share sheet', async () => {
  const seen = shell();
  assert.equal(isNative(), true);
  const how = await shareFile('{"app":"trailcraft"}', 'trailcraft-backup-2026-09-24.json');
  assert.equal(how, 'shared');
  assert.deepEqual(seen.writes, [{ path: 'trailcraft-backup-2026-09-24.json', directory: 'CACHE', data: '{"app":"trailcraft"}', encoding: 'utf8' }]);
  assert.deepEqual(seen.shares, [{ title: 'trailcraft-backup-2026-09-24.json', files: ['file:///cache/trailcraft-backup-2026-09-24.json'] }]);
});

await t('bytes (the PDF) go as base64, whole', async () => {
  const seen = shell();
  const bytes = new Uint8Array(70000).map((_, i) => i % 256);
  assert.equal(await shareFile(bytes, 'report.pdf'), 'shared');
  const w = seen.writes[0];
  assert.equal(w.encoding, undefined, 'no encoding means base64 to the plugin');
  assert.deepEqual(new Uint8Array(Buffer.from(w.data, 'base64')), bytes);
});

await t('a name is one file in the cache folder, never a path out of it', async () => {
  const seen = shell();
  await shareFile('x', '../../Documents/Bo’s run 1/2.gpx');
  assert.ok(!seen.writes[0].path.includes('/'), seen.writes[0].path);
  assert.ok(!seen.writes[0].path.startsWith('.'));
  await shareFile('x', '..');
  assert.equal(seen.writes[1].path, 'trailcraft');
});

await t('closing the sheet is not a failure; everything else says so', async () => {
  shell({ shareFails: 'Share canceled' });
  assert.equal(await shareFile('x', 'a.json'), 'cancelled');
  shell({ shareFails: 'Error sharing item' });
  assert.equal(await shareFile('x', 'a.json'), 'failed');
  shell({ writeFails: true });
  assert.equal(await shareFile('x', 'a.json'), 'failed');
});

await t('an app built before the plugins were in says there is nothing to share with', async () => {
  shell({ plugins: ['Filesystem'] });
  assert.equal(await shareFile('x', 'a.json'), 'none');
  shell({ plugins: [] });
  assert.equal(await shareFile('x', 'a.json'), 'none');
});

/* ── The coach's voice ─────────────────────────────────────────────── */

/** A shell with the Speech plugin, keeping what it was asked. */
function speechShell({ fails = false, voices = [], answer } = {}) {
  const seen = { spoken: [], stops: 0, listeners: [] };
  const Speech = {
    async voices() { if (fails) throw new Error('no'); return { voices }; },
    async speak(o) { if (fails) throw new Error('Nothing to say'); seen.spoken.push(o); return answer; },
    async stop() { seen.stops++; },
    async addListener(name, fn) { seen.listeners.push([name, fn]); return { remove() { seen.removed = true; } }; },
  };
  globalThis.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { Speech } } };
  return seen;
}

await t('in a browser, or a shell built before the plugin, the web view speaks', async () => {
  globalThis.window = {};
  assert.equal(canSpeakNative(), false);
  assert.equal(await nativeVoices(), null);
  assert.equal(await speakNative({ text: 'Off the trail' }), false);
  await stopNativeSpeech();
  assert.equal(await watchNativeVoices(() => {}), null);
  // A shell whose plugin list lacks Speech: registerPlugin would hand back a
  // proxy that answers every name, so it is never asked.
  globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: {}, registerPlugin: () => new Proxy({}, { get: () => async () => ({}) }) } };
  assert.equal(canSpeakNative(), false);
  assert.equal(await speakNative({ text: 'Off the trail' }), false);
  // Not inside the app, a Speech entry means nothing.
  globalThis.window = { Capacitor: { isNativePlatform: () => false, Plugins: { Speech: { speak() {} } } } };
  assert.equal(canSpeakNative(), false);
});

await t('in the app a call goes to iOS by voice name, language and pace', async () => {
  const seen = speechShell();
  assert.equal(canSpeakNative(), true);
  assert.equal(await speakNative({ text: 'Off the trail', voice: 'com.apple.voice.premium.en-GB.Serena', lang: 'en-GB', rate: 1 }), true);
  assert.equal(await speakNative({ text: 'Still off', lang: 'en-AU', rate: 1.05 }), true);
  assert.deepEqual(seen.spoken, [
    { text: 'Off the trail', voice: 'com.apple.voice.premium.en-GB.Serena', lang: 'en-GB', rate: 1 },
    { text: 'Still off', lang: 'en-AU', rate: 1.05 },
  ], 'no voice named: iOS is not handed a null to look up');
  await stopNativeSpeech();
  assert.equal(seen.stops, 1);
});

await t('the voices come as iOS lists them; a refusal is said, never thrown', async () => {
  const v = { identifier: 'com.apple.voice.premium.en-GB.Serena', name: 'Serena', language: 'en-GB', quality: 'premium', novelty: false };
  speechShell({ voices: [v] });
  assert.deepEqual(await nativeVoices(), [v]);
  speechShell({ fails: true });
  assert.equal(await nativeVoices(), null);
  assert.equal(await speakNative({ text: 'Off the trail' }), false);
});

await t('a voice finishing its download is heard about, and the listening can stop', async () => {
  const seen = speechShell();
  let heard = 0;
  const stop = await watchNativeVoices(() => heard++);
  assert.equal(seen.listeners[0][0], 'voicesChanged');
  seen.listeners[0][1]({});
  assert.equal(heard, 1);
  stop();
  assert.equal(seen.removed, true);
});

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

await t('the Speech plugin is in the app, registered, and answers to what native.js asks', () => {
  const swift = read('ios/App/App/TrailcraftSpeech.swift');
  assert.match(swift, /public let jsName = "Speech"/);
  for (const m of ['voices', 'speak', 'stop']) assert.match(swift, new RegExp(`CAPPluginMethod\\(name: "${m}", returnType: CAPPluginReturnPromise\\)`), m);
  assert.match(swift, /notifyListeners\("voicesChanged"/, 'the event watchNativeVoices listens for');
  for (const k of ['identifier', 'name', 'language', 'quality', 'novelty']) assert.match(swift, new RegExp(`"${k}": `), `each voice says its ${k}`);
  assert.match(swift, /quality == \.premium \{ return "premium" \}/);
  assert.match(swift, /AVSpeechSynthesisVoice\(identifier: \$0\)/, 'the voice is found by its identifier, never by its place in a list');
  assert.match(read('ios/App/App/TrailcraftNative.swift'), /bridge\?\.registerPluginInstance\(SpeechPlugin\(\)\)/);
  const proj = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.match(proj, /\/\* TrailcraftSpeech\.swift in Sources \*\/ = \{isa = PBXBuildFile;/);
  const sources = proj.slice(proj.indexOf('/* Begin PBXSourcesBuildPhase section */'), proj.indexOf('/* End PBXSourcesBuildPhase section */'));
  assert.match(sources, /TrailcraftSpeech\.swift in Sources/, 'compiled into the app');
});

await t('the voice is heard with the phone locked, over the music, and lets the music back', () => {
  const swift = read('ios/App/App/TrailcraftSpeech.swift');
  assert.match(swift, /setCategory\(\.playback, mode: \.voicePrompt,\s*options: \[\.duckOthers, \.interruptSpokenAudioAndMixWithOthers\]\)/);
  assert.match(swift, /setActive\(false, options: \.notifyOthersOnDeactivation\)/);
  assert.match(swift, /didFinish utterance[\s\S]*?ended\(\)/);
  assert.match(swift, /didCancel utterance[\s\S]*?ended\(\)/);
  const plist = read('ios/App/App/Info.plist');
  const modes = plist.slice(plist.indexOf('<key>UIBackgroundModes</key>'));
  const list = modes.slice(0, modes.indexOf('</array>'));
  assert.match(list, /<string>location<\/string>/, 'still recording in the dark');
  assert.match(list, /<string>audio<\/string>/, 'and heard there');
});

await t('a call iOS took but could not play is said to be unheard, not refused', async () => {
  /* During a phone call or Siri iOS will not give the app the sound. The
     plugin still takes the call and says so ({ heard: false }): a refusal
     would hand the coach to the web view for good. */
  speechShell({ answer: { heard: false } });
  assert.equal(await speakNative({ text: 'Off the trail' }), 'unheard');
  speechShell({ answer: { heard: true } });
  assert.equal(await speakNative({ text: 'Off the trail' }), true);
  speechShell();
  assert.equal(await speakNative({ text: 'Off the trail' }), true, 'a shell built before it said so is taken at its word');
  const swift = read('ios/App/App/TrailcraftSpeech.swift');
  assert.match(swift, /private func takeAudio\(\) -> Bool/);
  assert.match(swift, /let heard = self\.takeAudio\(\)[\s\S]*?call\.resolve\(\["heard": heard\]\)/, 'resolved with it, never rejected');
  assert.ok(!/call\.reject\([^)]*audio/i.test(swift));
  assert.match(swift, /name: AVAudioSession\.interruptionNotification/, 'a phone call or Siri is listened for');
  assert.match(swift, /== \.began else \{ return \}[\s\S]*?self\.synth\.stopSpeaking\(at: \.immediate\)/, 'and cuts the call off');
});

await t('the audio background mode is explained for App Review, with a way to hear it', () => {
  const doc = read('docs/IOS-APP.md');
  const notes = doc.slice(doc.indexOf('## App Review notes'));
  assert.ok(doc.includes('## App Review notes'), 'the notes are there to paste');
  assert.match(notes, /\*\*audio\*\* — used only for the coach's spoken calls during a coached run/);
  assert.match(notes, /made active only while a call is\s+> being spoken/);
  assert.match(notes, /\*\*location\*\*/);
  assert.match(notes, /Lock the phone/, 'with steps a reviewer can follow indoors');
  // The voice's way in Settings, by both its names.
  assert.match(doc, /Read & Speak \(called\s+Spoken Content before iOS 26\)/);
});

delete globalThis.window;
/* ── A video out of the app (shareBlob) ─────────────────────────────── */

await t('a video goes to the share sheet a piece at a time, from a folder that only keeps the last one', async () => {
  const seen = shell();
  const bytes = new Uint8Array(2500).map((_, i) => i % 251);
  const blob = new Blob([bytes], { type: 'video/mp4' });
  assert.equal(await shareBlob(blob, 'trailcraft-2026-10-13-rex-trail.mp4', { piece: 1000 }), 'shared');
  assert.deepEqual(seen.cleared, [{ path: 'clips', directory: 'CACHE', recursive: true }], 'the last video is cleared first, and a folder not there yet is no failure');
  assert.equal(seen.writes.length, 1);
  assert.deepEqual(seen.appends.length, 2, 'three pieces: one write, two appends');
  const path = 'clips/trailcraft-2026-10-13-rex-trail.mp4';
  assert.deepEqual([seen.writes[0].path, seen.writes[0].directory, seen.writes[0].recursive, seen.writes[0].encoding], [path, 'CACHE', true, undefined]);
  assert.ok(seen.appends.every(a => a.path === path && a.directory === 'CACHE' && !('encoding' in a)), 'as bytes, never as text');
  /* Put back together, it is the file that went in. */
  const back = Buffer.concat([seen.writes[0], ...seen.appends].map(o => Buffer.from(o.data, 'base64')));
  assert.deepEqual(new Uint8Array(back), bytes);
  assert.deepEqual(seen.shares, [{ title: 'trailcraft-2026-10-13-rex-trail.mp4', files: [`file:///cache/${path}`] }], 'the file itself, so the sheet offers Save Video');
});

await t('a video: a name cannot leave the folder, and each way it can go wrong has its own answer', async () => {
  let seen = shell();
  await shareBlob(new Blob(['x']), '../../Documents/Rex’s run.mp4');
  assert.equal(seen.writes[0].path, 'clips/Documents-Rex-s-run.mp4');
  seen = shell();
  assert.equal(await shareBlob(new Blob([]), 'empty.mp4'), 'shared', 'an empty file is still written once');
  assert.equal(seen.writes.length, 1);
  shell({ shareFails: 'Share canceled' });
  assert.equal(await shareBlob(new Blob(['x']), 'a.mp4'), 'cancelled');
  shell({ shareFails: 'boom' });
  assert.equal(await shareBlob(new Blob(['x']), 'a.mp4'), 'failed');
  shell({ writeFails: true });
  assert.equal(await shareBlob(new Blob(['x']), 'a.mp4'), 'failed');
  seen = shell({ appendFails: true });
  assert.equal(await shareBlob(new Blob(['xyz']), 'a.mp4', { piece: 1 }), 'failed', 'a disk that fills part-way');
  assert.equal(seen.shares.length, 0, 'half a video is never offered');
  shell({ plugins: ['Share'] });
  assert.equal(await shareBlob(new Blob(['x']), 'a.mp4'), 'none');
  globalThis.window = {};
  assert.equal(await shareBlob(new Blob(['x']), 'a.mp4'), 'none', 'in a browser there is no shell');
});

/** A shell with a real folder behind it: what is written is kept, appending
    to a file that is not there starts one (as the phone does), and every
    call takes a turn of the loop, so two writers at once would interleave. */
function disk() {
  const d = { files: new Map(), shared: [], writes: 0, cleared: 0, sheets: [] };
  const turn = () => new Promise(r => setImmediate(r));
  const bytes = (o) => Buffer.from(o.data, 'base64');
  globalThis.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {
    Filesystem: {
      async writeFile(o) { await turn(); d.writes++; d.files.set(o.path, bytes(o)); return { uri: `file:///cache/${o.path}` }; },
      async appendFile(o) { await turn(); d.files.set(o.path, Buffer.concat([d.files.get(o.path) ?? Buffer.alloc(0), bytes(o)])); },
      async rmdir() { await turn(); d.cleared++; d.files.clear(); },
    },
    Share: {
      /* The sheet stays up until it is let go, as a real one does. */
      share(o) { return new Promise((res) => { d.shared.push({ uri: o.files[0], bytes: Buffer.from(d.files.get(o.files[0].replace('file:///cache/', '')) ?? []) }); d.sheets.push(res); }); },
    },
  } } };
  d.settle = async () => { for (let i = 0; i < 400; i++) await turn(); };
  return d;
}

await t('two saves of one video at once are one write and one sheet, and the file shared is the file made', async () => {
  const d = disk();
  const src = new Uint8Array(40000).map((_, i) => (i * 7) % 251);
  const blob = new Blob([src], { type: 'video/mp4' });
  /* The app's own save as the recording ends, and a tap on Save video while it is still writing. */
  const a = shareBlob(blob, 'rex.mp4', { piece: 1000 });
  await new Promise(r => setImmediate(r));
  const b = shareBlob(blob, 'rex.mp4', { piece: 1000 });
  assert.equal(a, b, 'the second joins the first');
  await d.settle();
  assert.deepEqual([d.writes, d.cleared, d.shared.length], [1, 1, 1], 'one writer, one sheet');
  assert.deepEqual(new Uint8Array(d.shared[0].bytes), src, 'byte for byte the video that was recorded');
  d.sheets.shift()({});
  assert.deepEqual([await a, await b], ['shared', 'shared']);
  /* Once it is over, the same video can be shared again. */
  const c = shareBlob(blob, 'rex.mp4', { piece: 1000 });
  assert.notEqual(c, a);
  await d.settle();
  d.sheets.shift()({});
  assert.equal(await c, 'shared');
  assert.deepEqual(new Uint8Array(d.shared[1].bytes), src);
});

await t('two different videos never share the folder at the same time: the second waits for the first', async () => {
  const d = disk();
  const one = new Uint8Array(30000).fill(1), two = new Uint8Array(20000).fill(2);
  const a = shareBlob(new Blob([one]), 'one.mp4', { piece: 1000 });
  await new Promise(r => setImmediate(r));
  const b = shareBlob(new Blob([two]), 'two.mp4', { piece: 1000 });
  await d.settle();
  assert.equal(d.shared.length, 1, 'the second has not touched the folder while the first is out');
  assert.deepEqual(new Uint8Array(d.shared[0].bytes), one);
  d.sheets.shift()({});
  await d.settle();
  assert.equal(d.shared.length, 2);
  assert.deepEqual(new Uint8Array(d.shared[1].bytes), two, 'and each is whole');
  d.sheets.shift()({});
  assert.deepEqual([await a, await b], ['shared', 'shared']);
});

/* ── The screen kept on while a video is made (keepAwake) ───────────── */

await t('the shell holds the screen and lets it go, and where it cannot the answer is no', async () => {
  const calls = [];
  globalThis.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios',
    Plugins: { KeepAwake: { async on() { calls.push('on'); }, async off() { calls.push('off'); } } } } };
  assert.equal(await keepAwake(true), true);
  assert.equal(await keepAwake(false), true);
  assert.deepEqual(calls, ['on', 'off']);
  /* An app built before the switch: Capacitor hands back a stand-in whose every call is refused. */
  globalThis.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {},
    registerPlugin: () => new Proxy({}, { get: () => async () => { throw new Error('"KeepAwake" plugin is not implemented on ios'); } }) } };
  assert.equal(await keepAwake(true), false);
  assert.equal(await keepAwake(false), false, 'which is how the app finds out there is no hold');
  globalThis.window = {};
  assert.equal(await keepAwake(true), false, 'in a browser there is no shell');
  delete globalThis.window;
  assert.equal(await keepAwake(true), false);
});

console.log(`\n${pass} passed total\n`);
