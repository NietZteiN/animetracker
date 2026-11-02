import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPlayback, mergeRanges, defaults, syncPlan, safeUrl, excluded} from '../extension/lib/core.js';
test('continuous watched ranges survive revisits without counting rewatches twice', () => {
  let ranges = mergeRanges([], 0, 30);
  ranges = mergeRanges(ranges, 20, 40);
  ranges = mergeRanges(ranges, 100, 110);
  ranges = mergeRanges(ranges, 35, 105);
  assert.deepEqual(ranges, [[0, 110]]);
});
test('requires real playback coverage and minimum watch time, not just position', () => {
  const record = {key: 'a', ranges: [], playedSeconds: 0};
  const settings = {...defaults, threshold: 80, minSeconds: 120};
  let previous;
  for (let seconds = 0; seconds <= 480; seconds += 5) {
    const sample = {duration: 600, position: seconds, rate: 1, mediaId: 'one', playing: true};
    applyPlayback(record, sample, previous, settings, seconds * 1000);
    previous = {key: 'a', at: seconds * 1000, mediaId: 'one', position: seconds, playing: true};
  }
  assert.equal(record.completed, true); assert.equal(record.coverage, 0.8); assert.equal(record.playedSeconds, 480);
  const skipped = {key: 'b', ranges: [], playedSeconds: 0};
  applyPlayback(skipped, {duration: 600, position: 590, rate: 1, mediaId: 'one', playing: true}, {key: 'b', at: 0, position: 0, mediaId: 'one', playing: true}, settings, 5000);
  assert.equal(skipped.coverage, 0); assert.equal(skipped.completed, undefined);
});
test('ignores hidden-tab gaps, source switches, seeks, and invalid media', () => {
  const record = {key: 'a', ranges: [], playedSeconds: 0};
  const previous = {key: 'a', at: 0, position: 0, mediaId: 'one', playing: true};
  for (const sample of [
    {duration: 600, position: 40, mediaId: 'one'},
    {duration: 600, position: 5, mediaId: 'two'},
    {duration: 600, position: 5, mediaId: 'one', seeking: true},
    {duration: Infinity, position: 5, mediaId: 'one'}
  ]) applyPlayback(record, sample, previous, defaults, sample.position === 40 ? 40000 : 5000);
  assert.equal(record.playedSeconds, 0);
});
test('sync adds Watching without counting an unfinished episode and never reduces MAL progress', () => {
  assert.deepEqual(syncPlan({num_episodes: 12}, 4, false), {status: 'watching', num_watched_episodes: 0});
  assert.deepEqual(syncPlan({num_episodes: 12, my_list_status: {status: 'watching', num_episodes_watched: 5}}, 4, true), null);
  assert.deepEqual(syncPlan({num_episodes: 12, my_list_status: {status: 'watching', num_episodes_watched: 5}}, 12, true), {status: 'completed', num_watched_episodes: 12});
  assert.equal(syncPlan({num_episodes: 12, my_list_status: {status: 'completed', num_episodes_watched: 12}}, 3, false), null);
  assert.deepEqual(syncPlan({num_episodes: 0}, 500, true), {status: 'watching', num_watched_episodes: 500});
  assert.throws(() => syncPlan({num_episodes: 12}, 25, true), /offset/);
});
test('only HTTP watch URLs and exact host/subdomain exclusions are accepted', () => {
  assert.equal(safeUrl('javascript:alert(1)'), ''); assert.equal(safeUrl('https://a.example/watch#tracking'), 'https://a.example/watch');
  assert.equal(excluded('video.example.com', ['example.com']), true); assert.equal(excluded('notexample.com', ['example.com']), false);
});
