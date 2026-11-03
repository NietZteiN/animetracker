import {browser, $, rpc, el, notice, action, historyItem} from './shared.js';
let view, limit = 30, malLimit = 30;
async function refresh(populate = false) {
  view = await rpc('view');
  $('redirect').textContent = view.redirectUri;
  $('connected').hidden = !view.connected;
  $('connected').textContent = `Connected as ${view.user?.name || 'MyAnimeList user'}. Your trail is ready to sync.`;
  $('disconnect').hidden = !view.connected;
  $('authorize').textContent = view.connected ? 'Reconnect ↗' : 'Connect MyAnimeList ↗';
  $('pending').textContent = `${view.pending} pending update${view.pending === 1 ? '' : 's'}`;
  if (populate) {
    $('client-id').value = view.settings.clientId; $('enabled').checked = view.settings.enabled; $('auto-sync').checked = view.settings.autoSync;
    $('resume-prompts').checked = view.settings.resumePrompts;
    $('threshold').value = view.settings.threshold; $('min-seconds').value = view.settings.minSeconds;
    $('excluded').value = view.settings.excludedHosts.join('\n'); $('rules').value = JSON.stringify(view.settings.rules, null, 2);
  }
  renderHistory();
  renderMalProgress();
}
function renderMalProgress() {
  const cache = view.malProgress, query = $('mal-filter').value.trim().toLowerCase();
  const entries = Object.values(cache?.anime || {}).filter(entry => entry.title.toLowerCase().includes(query) || entry.alternative_titles?.en?.toLowerCase().includes(query))
    .sort((a, b) => (b.list_status.updated_at || '').localeCompare(a.list_status.updated_at || '') || a.title.localeCompare(b.title));
  $('mal-progress-status').textContent = view.malProgressError ? `Refresh failed: ${view.malProgressError}${cache ? ' Showing the last successful import.' : ''}` : cache ? `${Object.keys(cache.anime).length} series · refreshed ${new Date(cache.fetchedAt).toLocaleString()}` : view.connected ? 'Your shared progress is ready to import.' : 'Connect MyAnimeList to load your shared progress.';
  $('mal-progress').replaceChildren(...entries.slice(0, malLimit).map(entry => {
    const count = entry.list_status.num_episodes_watched;
    const finished = entry.list_status.status === 'completed' && !entry.list_status.is_rewatching || entry.num_episodes > 0 && count >= entry.num_episodes;
    return el('div', {class: 'history-item'}, [el('div', {class: 'episode-icon', text: String(count)}), el('div', {class: 'history-main'}, [
      el('strong', {text: entry.title}),
      el('p', {class: 'meta', text: `${count} / ${entry.num_episodes || '?'} episodes watched · ${finished ? 'Completed' : `Next: episode ${count + 1}`} · ${entry.list_status.status?.replaceAll('_', ' ') || 'On your list'}`}),
      el('a', {class: 'meta', text: 'View on MyAnimeList ↗', href: `https://myanimelist.net/anime/${entry.id}`, target: '_blank', rel: 'noopener noreferrer'})
    ])]);
  }));
  if (!entries.length) $('mal-progress').append(el('p', {class: 'empty', text: query ? 'No series match your search.' : cache ? 'Your MAL anime list is empty.' : 'Your MAL episode counts will appear here. Local history is kept separately.'}));
  $('mal-show-more').hidden = entries.length <= malLimit;
}
$('mal-filter').addEventListener('input', () => { malLimit = 30; renderMalProgress(); });
$('mal-show-more').addEventListener('click', () => { malLimit += 30; renderMalProgress(); });
$('pull-mal').addEventListener('click', event => action(event.currentTarget, async () => {
  const result = await rpc('pullProgress'); await refresh();
  notice(result.skipped ? result.reason : `Loaded ${result.count || 0} series from MyAnimeList.`, !!result.skipped);
}));
function renderHistory() {
  const query = $('filter').value.toLowerCase();
  const records = view.history.filter(r => r.title.toLowerCase().includes(query));
  $('history-count').textContent = `${records.length} episode${records.length === 1 ? '' : 's'} · saved on this browser`;
  $('history').replaceChildren(...records.slice(0, limit).map(r => historyItem(r, view.mappings[r.group], async record => {
    await rpc('complete', {key: record.key}); await refresh(); notice('Marked watched. It will sync when automatic sync is enabled, or with Sync now.');
  }, async record => { await rpc('remove', {key: record.key}); await refresh(); notice('Removed from local history. Your MAL list is unchanged.'); })));
  if (!records.length) $('history').append(el('div', {class: 'empty'}, [el('p', {text: query ? 'No episodes match your search.' : 'Your watch history starts with your next episode.'}), el('p', {class: 'help', text: 'Play an anime on any website, then open the Anime Trail toolbar popup.'})]));
  $('show-more').hidden = records.length <= limit;
}
$('filter').addEventListener('input', () => { limit = 30; renderHistory(); });
$('show-more').addEventListener('click', () => { limit += 30; renderHistory(); });
$('copy-redirect').addEventListener('click', event => action(event.currentTarget, async () => {
  const range = document.createRange(); range.selectNodeContents($('redirect')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  if (!document.execCommand('copy')) throw new Error('Select and copy the redirect URL shown above.');
  notice('Redirect URL copied.');
}));
$('client-form').addEventListener('submit', event => { event.preventDefault(); action(event.submitter, async () => {
  await rpc('settings', {settings: {clientId: $('client-id').value.trim()}}); notice('Client ID saved. You can now connect MyAnimeList.'); await refresh();
}); });
$('authorize').addEventListener('click', event => action(event.currentTarget, async () => {
  await rpc('settings', {settings: {clientId: $('client-id').value.trim()}});
  notice('Complete the MyAnimeList login in the authorization window.'); await rpc('connect');
  notice('Connected. Loading your progress from MyAnimeList…');
  try { await rpc('pullProgress'); await refresh(); notice('Connected and imported your MAL progress. Your next episode is available on this PC.'); }
  catch (error) { await refresh(); notice(`Connected, but progress could not be imported yet: ${error.message}`, true); }
}));
$('test-connection').addEventListener('click', event => action(event.currentTarget, async () => {
  notice('Checking the MAL login server and anime API…');
  const results = await rpc('testConnection');
  const failed = results.filter(r => !r.reachable);
  $('connection-test').replaceChildren(...results.map(result => el('p', {class: result.reachable ? 'help' : 'help danger', text: result.reachable ? `${result.name}: reachable (HTTP ${result.status})${result.authenticated === true ? ' · login valid' : result.authenticated === false ? ' · saved login was not accepted; reconnect your account' : ''}` : result.error})));
  $('connection-test').hidden = false;
  notice(failed.length ? 'MAL connection check found a problem. Details are below.' : 'Both MAL servers responded. If login still fails, try Connect MyAnimeList again and use the new error details.', !!failed.length);
}));
$('disconnect').addEventListener('click', event => action(event.currentTarget, async () => { await rpc('disconnect'); await refresh(); notice('Disconnected. Login tokens removed; history is still saved here.'); }));
$('sync').addEventListener('click', event => action(event.currentTarget, async () => {
  if (!view.connected) throw new Error('Connect MyAnimeList first.');
  const {pending} = await rpc('sync'); await refresh(); notice(pending ? `${pending} updates remain pending. Check episode matching and any errors below.` : 'Sync finished. Use the toolbar popup to link unmatched titles.');
}));
$('preferences').addEventListener('submit', event => { event.preventDefault(); action(event.submitter, async () => {
  await rpc('settings', {settings: {enabled: $('enabled').checked, autoSync: $('auto-sync').checked, resumePrompts: $('resume-prompts').checked, threshold: Number($('threshold').value), minSeconds: Number($('min-seconds').value), excludedHosts: $('excluded').value.split(/\n/).map(s => s.trim().toLowerCase()).filter(Boolean)}});
  notice('Tracking preferences saved.'); await refresh();
}); });
$('rules-form').addEventListener('submit', event => { event.preventDefault(); action(event.submitter, async () => {
  let rules; try { rules = JSON.parse($('rules').value); } catch { throw new Error('Site rules are not valid JSON.'); }
  await rpc('settings', {settings: {rules}}); notice('Custom site rules saved.');
}); });
$('export').addEventListener('click', event => action(event.currentTarget, async () => {
  const data = await rpc('export'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  const anchor = el('a', {href: url, download: `anime-trail-${new Date().toISOString().slice(0, 10)}.json`});
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  notice('Watch history exported. It includes watch-page URLs; keep it private.');
}));
action(null, () => refresh(true));
browser.storage.onChanged.addListener(changes => {
  if (changes.state && JSON.stringify(changes.state.oldValue?.malProgress) !== JSON.stringify(changes.state.newValue?.malProgress)) refresh().catch(() => {});
});
