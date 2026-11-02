import test from 'node:test';
import assert from 'node:assert/strict';
import {MalClient} from '../extension/lib/mal.js';
import {resumeOffer} from '../extension/lib/resume.js';
import {episodeKey, seriesKey} from '../extension/lib/core.js';
import {setup, memoryBrowser, candidate, sample} from './helpers.js';

const entry = (count = 7, extra = {}) => ({id: 52991, title: 'Frieren', alternative_titles: {en: 'Frieren'}, media_type: 'tv', num_episodes: 28, list_status: {status: 'watching', num_episodes_watched: count, updated_at: '2026-11-01T12:00:00+00:00'}, ...extra});
const withRemote = (records = [], count = 7) => ({history: Object.fromEntries(records.map(r => [r.key, r])), mappings: {[seriesKey(candidate)]: {id: 52991, offset: 0, numEpisodes: 28}}, malProgress: {userId: 1, fetchedAt: Date.now(), anime: {52991: entry(count)}}});
const local = (episode, completed = false) => ({...candidate, episode, key: episodeKey({...candidate, episode}), group: seriesKey(candidate), position: 120, duration: 1400, playedSeconds: 120, lastSeen: Date.now(), completed, url: 'https://watch.example/saved'});

test('a fresh PC pulls MAL counts and offers the next episode with no fabricated timestamp or history', async () => {
  const {controller, store, sender, browser} = setup({watchList: async () => [entry()]});
  await controller.pullProgress(true);
  assert.deepEqual((await store.load()).history, {});
  await controller.observe({candidate: {...candidate, episode: 1}, sample: sample(1)}, sender);
  const offer = (await store.session(7)).resumeOffer;
  assert.equal(offer.source, 'mal'); assert.equal(offer.targetEpisode, 8);
  assert.equal(offer.position, 0); assert.equal(offer.savedUrl, '');
  assert.ok(browser.messages.some(m => m.message.offer?.source === 'mal'));
  assert.equal((await store.load()).mappings[seriesKey(candidate)].id, 52991);
});
test('shared MAL progress beats stale local data but preserves a local next-episode timestamp and unsynced advances', () => {
  assert.equal(resumeOffer(withRemote([local(3)]), candidate).targetEpisode, 8);
  const next = resumeOffer(withRemote([local(8)]), candidate);
  assert.equal(next.targetEpisode, 8); assert.equal(next.position, 120); assert.equal(next.source, undefined);
  assert.equal(resumeOffer(withRemote([local(10, true)]), candidate).targetEpisode, 11);
  assert.equal(resumeOffer(withRemote([local(3)]), {...candidate, episode: 8}), null);
});
test('MAL offsets, known finales and completed entries do not suggest a nonexistent episode', () => {
  const state = withRemote([], 3);
  state.mappings[seriesKey(candidate)].offset = -24;
  assert.equal(resumeOffer(state, candidate).targetEpisode, 28);
  state.malProgress.anime[52991] = entry(28);
  assert.equal(resumeOffer(state, candidate), null);
  state.malProgress.anime[52991] = entry(12, {list_status: {status: 'completed', num_episodes_watched: 12}});
  assert.equal(resumeOffer(state, candidate), null);
});
test('background import arriving after playback updates the prompt without a page reload', async () => {
  const {controller, store, sender} = setup({watchList: async () => [entry()]});
  await controller.observe({candidate, sample: sample(1)}, sender);
  assert.equal((await store.session(7)).resumeOffer, null);
  await controller.pullProgress(true);
  await controller.observe({candidate, sample: sample(5)}, sender);
  assert.equal((await store.session(7)).resumeOffer.targetEpisode, 8);
});
test('imports are cached, concurrent pulls share a request, and manual refresh bypasses the cache', async () => {
  let calls = 0;
  const {controller} = setup({watchList: async () => { calls++; return [entry()]; }});
  await Promise.all([controller.pullProgress(), controller.pullProgress(), controller.pullProgress()]);
  assert.equal(calls, 1);
  await controller.pullProgress(); assert.equal(calls, 1);
  await controller.pullProgress(true); assert.equal(calls, 2);
});
test('failed refresh keeps the previous full import and records an actionable error', async () => {
  const {controller, store, mal} = setup({watchList: async () => [entry()]});
  await controller.pullProgress(true);
  mal.watchList = async () => { throw new Error('MAL is temporarily unavailable'); };
  await assert.rejects(controller.pullProgress(true), /temporarily/);
  const state = await store.load();
  assert.equal(state.malProgress.anime[52991].list_status.num_episodes_watched, 7);
  assert.match(state.malProgressError, /temporarily/);
});
test('disconnects and account changes cannot expose or commit another account’s imported list', async () => {
  let account = {user: {id: 1}, clientId: 'one'};
  const {controller, store, mal} = setup({auth: async () => account, watchList: async () => [entry()]});
  await controller.pullProgress(true);
  account = {user: {id: 2}, clientId: 'two'};
  assert.equal((await controller.view()).malProgress, null);
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  mal.watchList = async () => { started(); await new Promise(resolve => { release = resolve; }); return [entry(20)]; };
  const pulling = controller.pullProgress(true); await entered;
  account = null;
  release(); await pulling;
  assert.equal((await controller.view()).malProgress, null);
  await controller.disconnect(); assert.equal((await store.load()).malProgress, undefined);
});
test('pulling with automatic writes disabled remains read-only and does not block local playback', async () => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const {controller, store, sender, updates} = setup({watchList: async () => { started(); await new Promise(resolve => { release = resolve; }); return [entry()]; }});
  await controller.settings({autoSync: false});
  const pulling = controller.pullProgress(); await entered;
  await store.run(() => controller.observe({candidate, sample: sample(4)}, sender));
  release(); await pulling;
  assert.equal((await store.load()).history[episodeKey(candidate)].position, 4);
  assert.equal(updates.length, 0);
});
test('fresh installations read MAL progress before any local list updates and do not decrease the remote count', async () => {
  const order = [];
  const {controller, sender, updates} = setup({watchList: async () => { order.push('pull'); return [entry(7)]; }, detail: async id => { order.push('detail'); return {...entry(7), id, my_list_status: {status: 'watching', num_episodes_watched: 7}}; }});
  await controller.observe({candidate, sample: sample(2)}, sender);
  await controller.complete(episodeKey(candidate));
  await controller.sync();
  assert.equal(order[0], 'pull'); assert.equal(updates.length, 0);
});
test('successful uploads refresh the cached MAL count without waiting for another full import', async () => {
  const {controller, sender, store} = setup({watchList: async () => [entry(2)]});
  await controller.observe({candidate, sample: sample(2)}, sender);
  await controller.complete(episodeKey(candidate));
  await controller.sync();
  assert.equal((await store.load()).malProgress.anime[52991].list_status.num_episodes_watched, 3);
});
test('an on-page cloud suggestion cannot be accepted after disconnecting its account', async () => {
  let auth = {user: {id: 1}};
  const {controller, sender, store} = setup({auth: async () => auth, watchList: async () => [entry()]});
  await controller.pullProgress(true);
  await controller.observe({candidate, sample: sample(2)}, sender);
  const offer = (await store.session(7)).resumeOffer;
  auth = null;
  await assert.rejects(controller.resumeAction({offerId: offer.id, action: 'dismiss'}, sender), /expired/);
});

const response = data => ({ok: true, status: 200, json: async () => data});
test('MAL list reader follows all validated pages, includes hidden titles, and uses list_status', async () => {
  const browser = memoryBrowser();
  await browser.storage.local.set({auth: {accessToken: 'test-token', expiresAt: Date.now() + 3600000}});
  let calls = 0;
  const client = new MalClient(browser, async (raw, options) => {
    const url = new URL(raw); calls++;
    assert.equal(url.searchParams.get('nsfw'), 'true');
    assert.ok(url.searchParams.get('fields').includes('list_status'));
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return response({data: [{node: {...entry(), id: calls}, list_status: entry(calls).list_status}], paging: calls === 1 ? {next: 'https://api.myanimelist.net/v2/users/@me/animelist?offset=1000&limit=1000'} : {}});
  });
  const result = await client.watchList();
  assert.equal(calls, 2); assert.equal(result.length, 2); assert.equal(result[1].list_status.num_episodes_watched, 2);
});
test('MAL pagination cannot send credentials to a foreign host or loop forever', async () => {
  for (const next of ['https://untrusted.example/steal?offset=1000', 'https://api.myanimelist.net/v2/users/@me/animelist?offset=0']) {
    const browser = memoryBrowser();
    await browser.storage.local.set({auth: {accessToken: 'test-token', expiresAt: Date.now() + 3600000}});
    let calls = 0;
    const client = new MalClient(browser, async () => { calls++; return response({data: [], paging: {next}}); });
    await assert.rejects(client.watchList(), /pagination/);
    assert.equal(calls, 1);
  }
});
