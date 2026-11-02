import {$, rpc, el, notice, action, historyItem} from './shared.js';
let view, limit = 30;
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
}
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
  notice('Complete the MyAnimeList login in the authorization window.'); await rpc('connect'); await refresh(); notice('MyAnimeList connected. Automatic sync runs about once a minute.');
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
