import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {setup, candidate} from './helpers.js';
import {episodeKey} from '../extension/lib/core.js';

const read = name => readFileSync(new URL(`../extension/${name}`, import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function page(rpc, initialMedia = {}) {
  const dom = new JSDOM('<title>Frieren Episode 3</title><video></video>', {url: 'https://www.netflix.com/watch/123', runScripts: 'outside-only'});
  const intervals = [], video = dom.window.document.querySelector('video');
  const media = {paused: false, ended: false, readyState: 4, duration: 1200, currentTime: 10, playbackRate: 1, seeking: false, currentSrc: 'blob:episode', ...initialMedia};
  for (const key of Object.keys(media)) Object.defineProperty(video, key, {get: () => media[key], configurable: true});
  dom.window.setInterval = callback => { intervals.push(callback); return intervals.length; };
  dom.window.setTimeout = () => 1;
  dom.window.AnimeTrailBrowser = {browser: {runtime: {id: 'test', sendMessage: rpc}, storage: {onChanged: {addListener() {}}}}, onMessage() {}};
  dom.window.AnimeTrailResumeUI = {hide() {}, show() {}};
  dom.window.eval(read('lib/detection.js'));
  dom.window.eval(read('content.js'));
  return {dom, video, media, async tick() { for (const callback of intervals) await callback(); await settle(); }};
}

test('content script retries a transient configuration failure instead of staying disabled forever', async () => {
  let requests = 0, observations = 0;
  const fixture = page(async message => {
    if (message.type === 'contentConfig') {
      if (++requests === 1) throw new Error('Background starting');
      return {ok: true, data: {enabled: true}};
    }
    observations++; return {ok: true, data: {}};
  });
  try {
    await settle(); await fixture.tick();
    assert.equal(requests, 2); assert.ok(observations > 0);
  } finally { fixture.dom.window.close(); }
});

test('a short play/pause cycle records its final timestamp and watched interval without counting the pause', async t => {
  const {controller, store, sender} = setup();
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const fixture = page(async message => ({ok: true, data: message.type === 'contentConfig'
    ? await controller.config(sender) : await store.run(() => controller.observe(message, sender))}));
  try {
    await settle();
    now += 2000; fixture.media.currentTime = 12; fixture.media.paused = true;
    fixture.video.dispatchEvent(new fixture.dom.window.Event('pause', {bubbles: true}));
    await settle();
    let record = (await store.load()).history[episodeKey(candidate)];
    assert.equal(record.position, 12);
    assert.equal(record.playedSeconds, 2);
    now += 60000;
    fixture.media.paused = false;
    fixture.video.dispatchEvent(new fixture.dom.window.Event('play', {bubbles: true}));
    await settle();
    record = (await store.load()).history[episodeKey(candidate)];
    assert.equal(record.playedSeconds, 2);
  } finally { fixture.dom.window.close(); }
});

test('an initially paused player and periodic paused scans do not create history', async () => {
  const {controller, store, sender} = setup();
  const fixture = page(async message => ({ok: true, data: message.type === 'contentConfig'
    ? await controller.config(sender) : await store.run(() => controller.observe(message, sender))}), {paused: true});
  try {
    await settle();
    fixture.video.dispatchEvent(new fixture.dom.window.Event('loadedmetadata', {bubbles: true}));
    await settle(); await fixture.tick();
    assert.deepEqual((await store.load()).history, {});
  } finally { fixture.dom.window.close(); }
});

test('an explicitly paused tracking preference does not repeatedly request configuration', async () => {
  let requests = 0, observations = 0;
  const fixture = page(async message => {
    if (message.type === 'contentConfig') { requests++; return {ok: true, data: {enabled: false}}; }
    observations++; return {ok: true};
  });
  try {
    await settle(); await fixture.tick(); await fixture.tick();
    assert.equal(requests, 1); assert.equal(observations, 0);
  } finally { fixture.dom.window.close(); }
});
