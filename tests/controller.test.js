import test from 'node:test';
import assert from 'node:assert/strict';
import {setup, candidate, sample} from './helpers.js';
import {episodeKey, seriesKey} from '../extension/lib/core.js';

test('popup distinguishes a missing page script from a connected player without episode metadata', async () => {
  const {controller, browser} = setup();
  browser.tabs.sendMessage = async () => { throw new Error('Receiving end does not exist'); };
  assert.deepEqual((await controller.view(browser.tab.id)).playback, {connected: false});
  browser.tabs.sendMessage = async (id, message, options) => {
    assert.equal(message.type, 'animeTrailStatus'); assert.equal(options.frameId, 0);
    return {ok: true, configured: true, enabled: true, videoCount: 1, playingCount: 1, trackableCount: 1, scanFailed: false};
  };
  const view = await controller.view(browser.tab.id);
  assert.equal(view.current, null); assert.equal(view.playback.connected, true);
  assert.equal(view.playback.trackableCount, 1);
  assert.equal((await controller.view()).playback, null);
  browser.tab.incognito = true;
  assert.equal((await controller.view(browser.tab.id)).playback, null);
});

test('paused samples cannot start tracking or let another frame overwrite the owning player', async () => {
  const {controller, store, sender} = setup();
  await controller.observe({candidate, sample: {...sample(20), playing: false}}, sender);
  assert.deepEqual((await store.load()).history, {});
  await controller.observe({candidate, sample: sample(10)}, sender);
  await controller.observe({candidate, sample: {...sample(90), playing: false}}, {...sender, frameId: 3});
  assert.equal((await store.load()).history[episodeKey(candidate)].position, 10);
  await controller.observe({candidate, sample: {...sample(90), playing: false, mediaId: 'replacement'}}, sender);
  assert.equal((await store.load()).history[episodeKey(candidate)].position, 10);
});
test('embedded player uses parent title and persists cross-site episode progress', async () => {
  const {controller, store, sender, browser} = setup();
  await controller.observe({candidate, sample: null}, sender);
  const frame = {...sender, frameId: 3, url: 'https://player.example/embed/xyz'};
  await controller.observe({candidate: {title: 'Player', episode: 1}, sample: sample(10)}, frame);
  let state = await store.load(); assert.equal(state.history[episodeKey(candidate)].title, 'Frieren');
  state.history[episodeKey(candidate)].ranges = [[0, 500]]; await store.save(state);
  browser.tab.url = 'https://different.example/watch/other-id';
  await controller.observe({candidate, sample: sample(510)}, {...sender, tab: browser.tab, url: browser.tab.url});
  state = await store.load();
  assert.equal(Object.keys(state.history).length, 1); assert.deepEqual(state.history[episodeKey(candidate)].ranges, [[0, 500]]);
  assert.equal(state.history[episodeKey(candidate)].hostname, 'different.example');
});
test('does not record browsing an episode page before playback, private tabs, or excluded sites', async () => {
  const {controller, store, sender} = setup();
  await controller.observe({candidate, sample: null}, sender); assert.deepEqual((await store.load()).history, {});
  await controller.observe({candidate, sample: sample(2)}, {...sender, tab: {...sender.tab, incognito: true}}); assert.deepEqual((await store.load()).history, {});
  await controller.settings({excludedHosts: ['watch.example']});
  await controller.observe({candidate, sample: sample(2)}, sender); assert.deepEqual((await store.load()).history, {});
});
test('exact title matching queues Watching, then completed progress; retries survive restart', async () => {
  const {controller, store, sender, updates} = setup();
  await controller.observe({candidate, sample: sample(10)}, sender);
  await controller.sync();
  let state = await store.load();
  assert.equal(state.mappings[seriesKey(candidate)].id, 52991);
  assert.equal(state.history[episodeKey(candidate)].synced.completed, 0);
  assert.equal(updates.length, 0); // MAL already has Watching + episode 2; unfinished episode 3 changes nothing.
  await controller.complete(episodeKey(candidate)); await controller.sync();
  assert.deepEqual(updates[0], {id: 52991, plan: {status: 'watching', num_watched_episodes: 3}});
  state = await store.load(); assert.deepEqual(state.queue, {}); assert.equal(state.history[episodeKey(candidate)].synced.completed, 1);
});
test('network failures retain pending progress with exponential retry and explicit errors', async () => {
  const {controller, store, sender, mal} = setup();
  await controller.observe({candidate, sample: sample(10)}, sender);
  await controller.complete(episodeKey(candidate));
  mal.detail = async () => { throw new Error('offline'); };
  await controller.sync(); const state = await store.load();
  assert.equal(state.queue[episodeKey(candidate)].attempts, 1); assert.ok(state.queue[episodeKey(candidate)].nextAt > Date.now());
  assert.equal(state.history[episodeKey(candidate)].error, 'offline');
});
test('manual match applies season offset and avoids duplicate syncs', async () => {
  const {controller, store, sender, updates} = setup();
  const input = {...candidate, season: 2, episode: 25};
  await controller.observe({candidate: input, sample: sample(10)}, sender);
  await controller.link({key: episodeKey(input), malId: 52991, offset: -24}); await controller.complete(episodeKey(input));
  await controller.sync(); assert.equal(updates.length, 0); // MAL has already watched episode 2, so no decrement.
  const state = await store.load(); assert.equal(state.history[episodeKey(input)].synced.completed, 1);
  await controller.observe({candidate: input, sample: sample(15)}, sender); assert.deepEqual((await store.load()).queue, {});
});
test('paused autosync retains progress, manual sync can flush it, disabled tracking blocks all sync', async () => {
  const {controller, store, sender, updates} = setup();
  await controller.observe({candidate, sample: sample(10)}, sender); await controller.complete(episodeKey(candidate));
  await controller.settings({autoSync: false}); await controller.sync(); assert.equal(updates.length, 0);
  await controller.sync(true); assert.equal(updates.length, 1);
  await controller.settings({enabled: false}); await controller.sync(true); assert.equal(updates.length, 1);
  assert.deepEqual((await store.load()).queue, {});
});
test('storage serialization prevents dropped concurrent updates and recovers after failure', async () => {
  const {store} = setup();
  await Promise.all(Array.from({length: 20}, () => store.run(async () => { const s = await store.load(); s.count = (s.count || 0) + 1; await store.save(s); })));
  assert.equal((await store.load()).count, 20);
  await assert.rejects(store.run(() => { throw new Error('test'); }));
  assert.equal(await store.run(() => 42), 42);
});
test('settings validates inputs and correction rejects restricted or malformed pages', async () => {
  const {controller, browser} = setup();
  await assert.rejects(controller.settings({threshold: 1}), /threshold/);
  await assert.rejects(controller.settings({excludedHosts: ['https://example.com']}), /hostnames/);
  await assert.rejects(controller.settings({rules: [{}]}), /hostname/);
  await assert.rejects(controller.correct({tabId: 7, candidate: {...candidate, episode: 0}}), /positive/);
  browser.tab.url = 'about:config';
  await assert.rejects(controller.correct({tabId: 7, candidate}), /unavailable/);
});
test('manual correction survives metadata scans and resets on the next SPA episode', async () => {
  const {controller, store, sender} = setup();
  await controller.observe({candidate, sample: sample(10)}, sender);
  await controller.correct({tabId: 7, candidate: {...candidate, title: 'Sousou no Frieren'}});
  await controller.observe({candidate, sample: sample(15)}, sender);
  assert.equal((await controller.view(7)).current.title, 'Sousou no Frieren');
  await controller.observe({candidate: {...candidate, episode: 4}, sample: sample(1)}, sender);
  assert.equal((await controller.view(7)).current.episode, 4);
  assert.equal((await store.session(7)).manual, undefined);
});
test('slow sync does not block playback writes and never overwrites newer progress', async () => {
  const {controller, store, sender, mal} = setup();
  await controller.observe({candidate, sample: sample(10)}, sender);
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  mal.search = async () => { started(); await new Promise(resolve => { release = resolve; }); return [{id: 52991, title: 'Frieren', media_type: 'tv'}]; };
  const sync = controller.sync();
  await entered;
  await store.run(() => controller.observe({candidate, sample: sample(20)}, sender));
  await store.run(() => controller.complete(episodeKey(candidate)));
  release(); await sync;
  const state = await store.load();
  assert.equal(state.history[episodeKey(candidate)].position, 20);
  assert.equal(state.history[episodeKey(candidate)].completed, true);
  assert.equal(state.history[episodeKey(candidate)].synced.completed, 1);
});
test('removing local history during an in-flight sync does not resurrect it', async () => {
  const {controller, store, sender, mal} = setup();
  await controller.observe({candidate, sample: sample(10)}, sender);
  await controller.sync(); await controller.complete(episodeKey(candidate));
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  mal.detail = async () => { started(); await new Promise(resolve => { release = resolve; }); return {id: 52991, num_episodes: 28}; };
  const sync = controller.sync(); await entered;
  await store.run(() => controller.remove(episodeKey(candidate))); release(); await sync;
  const state = await store.load(); assert.deepEqual(state.history, {}); assert.deepEqual(state.queue, {});
});
