import {$, rpc, el, notice, action, episodeLabel, time, historyItem} from './shared.js';
let tabId, view, current;
async function refresh() {
  view = await rpc('view', {tabId}); current = view.current;
  const enabled = view.settings.enabled;
  $('tracking-label').textContent = enabled ? 'Tracking' : 'Paused';
  $('pause').textContent = enabled ? 'Pause tracking' : 'Resume tracking';
  $('empty').hidden = !!current; $('current').hidden = !current;
  $('mark').hidden = !current || !!current.completed;
  if (current) {
    $('title').textContent = current.title;
    $('episode').textContent = episodeLabel(current);
    const pct = Math.round((current.coverage || 0) * 100);
    $('progress').style.width = `${pct}%`;
    $('position').textContent = current.completed ? 'Watched ✓' : current.duration ? `${time(current.position)} / ${time(current.duration)}` : 'Waiting for playback…';
    $('percentage').textContent = `${pct}% watched`;
    $('sync-state').textContent = current.error || (current.completed ? 'Episode saved in your watch history.' : `Marks watched after ${view.settings.threshold}% coverage and ${view.settings.minSeconds}s of playback.`);
  }
  $('account').textContent = view.connected ? view.user?.name || 'Connected' : 'Not connected';
  $('connect').hidden = view.connected; $('sync').hidden = !view.connected;
  $('match').hidden = !view.connected || !current;
  const mapping = current && view.mappings[current.group];
  const shared = mapping && view.malProgress?.anime?.[mapping.id];
  $('mal-message').textContent = !view.connected ? 'Connect once to share episode progress between PCs.' : mapping ? `Linked to ${mapping.title}${mapping.offset ? ` · offset ${mapping.offset}` : ''}${shared ? ` · MAL: ${shared.list_status.num_episodes_watched} episodes watched` : ''}${mapping.automatic ? ' · auto-matched' : ''}` : 'Your MAL list is used to match shows and find your next episode. You can choose the correct season here.';
  $('footer-status').textContent = view.pending ? `${view.pending} update${view.pending === 1 ? '' : 's'} pending` : 'Your trail, across the web.';
  $('history').replaceChildren(...view.history.slice(0, 4).map(r => historyItem(r, view.mappings[r.group])));
  if (!view.history.length) $('history').append(el('p', {class: 'help', text: 'Watched episodes and playback progress appear here.'}));
}
const openOptions = () => browser.runtime.openOptionsPage();
for (const id of ['settings', 'library', 'connect']) $(id).addEventListener('click', openOptions);
$('pause').addEventListener('click', event => action(event.currentTarget, async () => { await rpc('settings', {settings: {enabled: !view.settings.enabled}}); await refresh(); }));
$('sync').addEventListener('click', event => action(event.currentTarget, async () => { const result = await rpc('sync'); await refresh(); notice(result.pending ? `${result.pending} update(s) still pending. Check matching or connection errors.` : 'Sync finished. Unmatched titles can be linked with “Find / change match”.'); }));
$('mark').addEventListener('click', event => action(event.currentTarget, async () => {
  if (!view.history.some(r => r.key === current.key)) await rpc('correct', {tabId, candidate: {title: current.title, episode: current.episode, season: current.season}});
  await rpc('complete', {key: current.key}); await refresh();
}));
$('edit').addEventListener('click', () => {
  $('correction').hidden = !$('correction').hidden;
  $('edit-title').value = current?.title || ''; $('edit-season').value = current?.season || ''; $('edit-episode').value = current?.episode || '';
  if (!$('correction').hidden) $('edit-title').focus();
});
$('correction').addEventListener('submit', event => { event.preventDefault(); action(event.submitter, async () => {
  await rpc('correct', {tabId, candidate: {title: $('edit-title').value.trim(), episode: Number($('edit-episode').value), season: $('edit-season').value ? Number($('edit-season').value) : null}});
  $('correction').hidden = true; notice('Correction saved.'); await refresh();
}); });
$('match').addEventListener('click', () => {
  $('match-panel').hidden = !$('match-panel').hidden;
  $('query').value = `${current?.title || ''}${current?.season > 1 ? ` season ${current.season}` : ''}`;
  $('offset').value = view.mappings[current?.group]?.offset || 0;
});
async function link(id) {
  if (!view.history.some(r => r.key === current.key)) await rpc('correct', {tabId, candidate: {title: current.title, episode: current.episode, season: current.season}});
  await rpc('link', {key: current.key, malId: id, offset: Number($('offset').value)});
  $('match-panel').hidden = true; notice('MAL match saved. Progress will sync shortly.'); await refresh();
}
$('search-form').addEventListener('submit', event => { event.preventDefault(); action(event.submitter, async () => {
  const query = $('query').value.trim();
  const id = /^(?:https:\/\/myanimelist\.net\/anime\/)?(\d+)(?:\/.*)?$/.exec(query);
  if (id) { await link(Number(id[1])); return; }
  const nodes = await rpc('search', {query});
  $('results').replaceChildren(...nodes.map(node => el('button', {type: 'button', class: 'result', onClick: e => action(e.currentTarget, () => link(node.id))}, [el('strong', {text: node.title}), el('span', {class: 'meta', text: `${node.media_type?.toUpperCase() || 'Anime'} · ${node.num_episodes || '?'} episodes · ${node.start_season?.year || 'Year unknown'} · MAL ${node.id}`})])));
  if (!nodes.length) $('results').append(el('p', {class: 'help', text: 'No matches. Try the Japanese or English title, or paste the MAL anime ID.'}));
}); });
action(null, async () => {
  const [tab] = await browser.tabs.query({active: true, currentWindow: true}); tabId = tab?.id;
  await refresh();
});
setInterval(() => { if (!$('correction').hidden || !$('match-panel').hidden) return; refresh().catch(() => {}); }, 5000);
