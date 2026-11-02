import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {resumeOffer} from '../extension/lib/resume.js';
import {episodeKey, seriesKey, defaults} from '../extension/lib/core.js';
import {setup, candidate, sample} from './helpers.js';

const saved = (episode = 5, extra = {}) => ({...candidate, episode, key: episodeKey({...candidate, episode}), group: seriesKey(candidate), position: 620, duration: 1400, playedSeconds: 120, lastSeen: 100, url: `https://old.example/watch/frieren-episode-${episode}`, ...extra});
const stateWith = (...records) => ({settings: {...defaults}, mappings: {}, history: Object.fromEntries(records.map(r => [r.key, r]))});

test('wrong episode offers the last meaningful unfinished episode without mixing seasons or titles', () => {
  const state = stateWith(saved(), saved(1, {lastSeen: 200, playedSeconds: 0, position: 3}));
  const offer = resumeOffer(state, {...candidate, episode: 1});
  assert.equal(offer.kind, 'episode'); assert.equal(offer.targetEpisode, 5); assert.equal(offer.position, 620);
  assert.equal(resumeOffer(state, {...candidate, season: 2}), null);
  assert.equal(resumeOffer(state, {...candidate, title: 'A completely different anime'}), null);
});
test('same episode offers timestamp resume and completed episodes suggest the next, within known totals', () => {
  assert.equal(resumeOffer(stateWith(saved()), {...candidate, episode: 5}).kind, 'seek');
  const state = stateWith(saved(5, {completed: true}));
  const offer = resumeOffer(state, candidate);
  assert.equal(offer.kind, 'next'); assert.equal(offer.targetEpisode, 6); assert.equal(offer.position, 0);
  assert.equal(resumeOffer(state, {...candidate, episode: 6}), null);
  state.mappings[seriesKey(candidate)] = {id: 1, numEpisodes: 5};
  assert.equal(resumeOffer(state, candidate), null);
});
test('MAL aliases and offsets share resume identity but different MAL entries stay separate', () => {
  const record = saved(25, {title: 'Sousou no Frieren', season: 2});
  record.key = episodeKey(record); record.group = seriesKey(record);
  const state = stateWith(record);
  state.mappings[record.group] = {id: 52991, offset: -24};
  state.mappings[seriesKey(candidate)] = {id: 52991, offset: 0};
  const offer = resumeOffer(state, candidate);
  assert.equal(offer.targetEpisode, 1); assert.equal(offer.targetCanonical, 1);
  state.mappings[seriesKey(candidate)].id = 100;
  assert.equal(resumeOffer(state, candidate), null);
});
test('offer is captured before opening playback overwrites its saved timestamp; dismissal does not repeat', async () => {
  const {controller, store, sender, browser} = setup();
  await store.save(stateWith(saved(3)));
  await controller.observe({candidate, sample: sample(1)}, sender);
  assert.equal((await store.load()).history[episodeKey(candidate)].position, 620);
  const offer = (await store.session(7)).resumeOffer;
  assert.equal(offer.position, 620);
  assert.equal(browser.messages.at(-1).options.frameId, 0);
  await controller.resumeAction({offerId: offer.id, action: 'dismiss'}, sender);
  assert.equal((await store.load()).history[episodeKey(candidate)].position, 1);
  const count = browser.messages.length;
  await controller.observe({candidate, sample: sample(5)}, sender);
  assert.equal(browser.messages.length, count);
});
test('resume seek targets the owning iframe using the stored time, not a supplied time', async () => {
  const {controller, store, sender, browser} = setup();
  await store.save(stateWith(saved(3)));
  await controller.observe({candidate, sample: null}, sender);
  await controller.observe({sample: sample(1)}, {...sender, frameId: 11});
  const offer = (await store.session(7)).resumeOffer;
  await controller.resumeAction({offerId: offer.id, action: 'seek', position: 9999}, sender);
  const seek = browser.messages.find(m => m.message.type === 'animeTrailSeek');
  assert.equal(seek.options.frameId, 11); assert.equal(seek.message.position, 620);
  assert.equal((await store.session(7)).previous, undefined);
  await assert.rejects(controller.resumeAction({offerId: offer.id, action: 'seek'}, sender), /expired/);
});
test('resume navigation preserves pending timestamp and only seeks when the right episode appears', async () => {
  const {controller, store, sender, browser} = setup();
  await store.save(stateWith(saved(5)));
  await controller.observe({candidate, sample: sample(1)}, sender);
  const offer = (await store.session(7)).resumeOffer;
  await assert.rejects(controller.resumeAction({offerId: offer.id, action: 'navigate', url: 'https://unrelated.example/'}, sender), /not valid/);
  await controller.resumeAction({offerId: offer.id, action: 'navigate', url: 'https://watch.example/watch/frieren-episode-5'}, sender);
  await controller.observe({candidate: {...candidate, episode: 4}, sample: sample(1)}, sender);
  assert.ok((await store.session(7)).pendingResume);
  assert.equal(browser.messages.some(m => m.message.type === 'animeTrailSeek'), false);
  await controller.observe({candidate: {...candidate, episode: 5}, sample: sample(1)}, sender);
  assert.equal(browser.messages.find(m => m.message.type === 'animeTrailSeek').message.position, 620);
  assert.equal((await store.session(7)).pendingResume, undefined);
});
test('iframe actions, stale suggestions, excluded sites, and disabled prompts cannot trigger resume', async () => {
  const {controller, store, sender, browser} = setup();
  await store.save(stateWith(saved()));
  await controller.observe({candidate, sample: sample(1)}, sender);
  const offer = (await store.session(7)).resumeOffer;
  await assert.rejects(controller.resumeAction({offerId: offer.id, action: 'dismiss'}, {...sender, frameId: 4}), /unavailable/);
  await assert.rejects(controller.resumeAction({offerId: 'stale', action: 'dismiss'}, sender), /expired/);
  await controller.settings({resumePrompts: false});
  browser.messages.length = 0;
  await controller.observe({candidate, sample: sample(2)}, sender);
  assert.equal(browser.messages.length, 0);
});
test('already-restored playback does not show a timestamp prompt', async () => {
  const {controller, store, sender, browser} = setup();
  await store.save(stateWith(saved(3)));
  await controller.observe({candidate, sample: sample(619)}, sender);
  assert.equal(browser.messages.length, 0);
});

const detectionScript = readFileSync(new URL('../extension/lib/detection.js', import.meta.url), 'utf8');
const uiScript = readFileSync(new URL('../extension/resume-ui.js', import.meta.url), 'utf8');
function uiPage(html = '') {
  const dom = new JSDOM(html, {url: 'https://watch.example/watch/episode-1', runScripts: 'outside-only'});
  dom.window.browser = {runtime: {sendMessage: async () => ({ok: true})}};
  dom.window.eval(detectionScript); dom.window.eval(uiScript);
  return dom;
}
test('episode-link detection prefers a current-site episode list and rejects ambiguous or unsafe links', () => {
  const dom = uiPage('<nav class="episodes"><a href="/watch/e5">Episode 5</a></nav><a href="https://other.example/episode-5">Episode 5</a>');
  const offer = resumeOffer(stateWith(saved()), candidate);
  assert.equal(dom.window.AnimeTrailResumeUI.episodeLink(offer), 'https://watch.example/watch/e5');
  dom.window.document.querySelector('nav').insertAdjacentHTML('beforeend', '<a href="/different">Episode 5</a>');
  assert.equal(dom.window.AnimeTrailResumeUI.episodeLink(offer), null);
});
test('resume UI isolates styles, escapes page titles, and dismisses after an explicit action', async () => {
  const dom = uiPage();
  const offer = {...resumeOffer(stateWith(saved()), candidate), title: '<img src=x onerror=alert(1)>'};
  dom.window.AnimeTrailResumeUI.show(offer);
  const host = dom.window.document.querySelector('[data-anime-trail-resume]');
  assert.ok(host.shadowRoot.querySelector('[role=dialog]'));
  assert.equal(host.shadowRoot.querySelector('img'), null);
  assert.ok(host.shadowRoot.textContent.includes('episode 5 at 10:20'));
  dom.window.AnimeTrailResumeUI.show(offer);
  assert.equal(dom.window.document.querySelectorAll('[data-anime-trail-resume]').length, 1);
  host.shadowRoot.querySelector('button[aria-label="Dismiss resume suggestion"]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelector('[data-anime-trail-resume]'), null);
});
