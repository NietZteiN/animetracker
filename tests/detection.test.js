import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {detect, snapshot, parseLabel, cleanTitle, automaticMatch, seriesKey} from '../extension/lib/core.js';
const page = (html, url = 'https://stream.example/watch/123') => {
  const doc = new JSDOM(html).window.document;
  return detect(snapshot(doc, url));
};
test('detects season and episode across common title styles', () => {
  for (const label of ['Season 2 Episode 5', 'S02E05', '2x05', '2nd Season Ep. 5']) {
    const result = page(`<title>Watch Jujutsu Kaisen ${label} English Subbed | Random Stream</title>`);
    assert.equal(result.title, 'Jujutsu Kaisen'); assert.equal(result.episode, 5); assert.equal(result.season, 2);
  }
});
test('structured series metadata beats episode name and page brand', () => {
  const result = page(`<title>Episode 7 | Unknown Player</title><script type="application/ld+json">${JSON.stringify({'@graph': [{'@type': 'TVEpisode', name: 'The journey', episodeNumber: 7, partOfSeries: {name: 'Frieren: Beyond Journey’s End'}, partOfSeason: {seasonNumber: 1}}]})}</script>`);
  assert.equal(result.title, 'Frieren: Beyond Journey’s End'); assert.equal(result.episode, 7); assert.equal(result.confidence, 'high');
});
test('a heading that names the episode does not displace an explicit show title', () => {
  const result = page('<h1>The Journey Begins</h1><title>Frieren Episode 1 | Stream</title>');
  assert.equal(result.title, 'Frieren'); assert.equal(result.episode, 1);
});
test('combines heading with selected episode and URL hints', () => {
  const result = page('<h1>One Piece</h1><div data-episode-number="1122"></div>');
  assert.equal(result.title, 'One Piece'); assert.equal(result.episode, 1122);
  const urlResult = page('<h1>Dr. Stone</h1>', 'https://example.com/watch/dr-stone-season-3-episode-4');
  assert.equal(urlResult.title, 'Dr. Stone'); assert.equal(urlResult.season, 3); assert.equal(urlResult.episode, 4);
  assert.equal(page('<h1>86</h1>', 'https://example.com/watch?id=abc&episode=7').episode, 7);
});
test('custom selectors support labeled and numeric episode and season values', () => {
  const doc = new JSDOM('<div class="show">Spy x Family</div><b class="ep">Episode 8</b><i class="season">Season 2</i>').window.document;
  const result = detect(snapshot(doc, 'https://example.com/', {titleSelector: '.show', episodeSelector: '.ep', seasonSelector: '.season'}));
  assert.equal(result.title, 'Spy x Family'); assert.equal(result.episode, 8); assert.equal(result.season, 2);
});
test('does not infer episodes from arbitrary numbers, years, fractions or decimals', () => {
  for (const title of ['My Anime 2026', 'Watch 86 Online', 'Anime Episode 12.5', 'Video 1080p', 'Home']) assert.equal(page(`<title>${title}</title>`), null, title);
  assert.equal(parseLabel('Episode 0').episode, null);
  assert.equal(parseLabel('第12話').episode, 12);
  assert.equal(cleanTitle('Re:ZERO - Starting Life in Another World Season 2 Episode 4'), 'Re:ZERO - Starting Life in Another World');
});
test('malformed publisher JSON and invalid CSS do not break generic detection', () => {
  assert.equal(page('<title>Frieren Episode 4</title><script type="application/ld+json">{bad</script>').episode, 4);
  const doc = new JSDOM('<title>Frieren Episode 2</title>').window.document;
  assert.equal(detect(snapshot(doc, 'https://example.com/', {titleSelector: '['})).episode, 2);
});
test('matching is exact, unambiguous and season-aware', () => {
  const first = {id: 1, title: 'Jujutsu Kaisen', media_type: 'tv'};
  const second = {id: 2, title: 'Jujutsu Kaisen 2nd Season', media_type: 'tv'};
  assert.equal(automaticMatch({title: 'Jujutsu Kaisen', season: 2}, [first, second])?.id, 2);
  assert.equal(automaticMatch({title: 'Jujutsu Kaisen', season: 3}, [first, second]), null);
  assert.equal(automaticMatch({title: 'Jujutsu Kaisen'}, [first, {...first, id: 3}]), null);
  assert.equal(automaticMatch({title: 'Attack on Titan', season: 4}, [{id: 4, title: 'Attack on Titan: The Final Season', media_type: 'tv'}]), null);
  assert.equal(automaticMatch({title: 'Frieren: Beyond Journey’s End'}, [{id: 5, title: 'Sousou no Frieren', alternative_titles: {en: 'Frieren: Beyond Journey’s End'}, media_type: 'tv'}])?.id, 5);
  assert.equal(seriesKey({title: 'SPY × FAMILY', season: 1}), seriesKey({title: 'Spy Family'}));
});
