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
import { shareFile, isNative, canSpeakNative, nativeVoices, speakNative, stopNativeSpeech, watchNativeVoices } from '../public/native.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

/** A shell with the two plugins, each keeping what it was handed. */
function shell({ shareFails = null, writeFails = false, plugins = ['Filesystem', 'Share'] } = {}) {
  const seen = { writes: [], shares: [] };
  const all = {
    Filesystem: {
      async writeFile(o) {
        if (writeFails) throw new Error('disk');
        seen.writes.push(o);
        return { uri: `file:///cache/${o.path}` };
      },
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
function speechShell({ fails = false, voices = [] } = {}) {
  const seen = { spoken: [], stops: 0, listeners: [] };
  const Speech = {
    async voices() { if (fails) throw new Error('no'); return { voices }; },
    async speak(o) { if (fails) throw new Error('Nothing to say'); seen.spoken.push(o); },
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

delete globalThis.window;
console.log(`\n${pass} passed total\n`);
