import '../lib/browser.js';
export const {browser} = globalThis.AnimeTrailBrowser;
export const $ = id => document.getElementById(id);
export async function rpc(type, payload = {}) {
  const result = await browser.runtime.sendMessage({type, ...payload});
  if (!result?.ok) throw new Error(result?.error || 'The extension is unavailable. Reload it and try again.');
  return result.data;
}
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value != null) node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}
export function notice(message, error = false) {
  const target = $('notice');
  target.textContent = message;
  target.classList.toggle('error', error);
  target.hidden = !message;
}
export async function action(button, task) {
  if (button) button.disabled = true;
  try { await task(); } catch (error) { notice(error.message, true); }
  finally { if (button) button.disabled = false; }
}
export const episodeLabel = r => `${r.season ? `S${r.season} · ` : ''}Episode ${r.episode}`;
export const time = seconds => `${Math.floor((seconds || 0) / 60)}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;
export const when = timestamp => new Date(timestamp).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
export function historyItem(record, mapping, onComplete, onRemove) {
  const status = record.error ? record.error : record.synced ? `MAL ${record.completed && record.synced.completed ? 'synced' : 'watching'} · ${mapping?.title || ''}` : mapping ? 'Sync pending' : 'Saved locally · MAL match needed';
  const resume = el('a', {text: 'Open page ↗', href: record.url, target: '_blank', rel: 'noopener noreferrer', class: 'meta'});
  const main = el('div', {class: 'history-main'}, [
    el('strong', {text: record.title}),
    el('p', {class: 'meta', text: `${episodeLabel(record)} · ${record.completed ? 'Watched' : `${time(record.position)} / ${time(record.duration)}`} · ${when(record.lastSeen)}`}),
    el('p', {class: 'meta', text: status}), resume
  ]);
  const item = el('div', {class: 'history-item'}, [el('div', {class: 'episode-icon', text: String(record.episode).padStart(2, '0')}), main]);
  if (onComplete || onRemove) {
    const actions = el('div', {class: 'item-actions'});
    if (onComplete && !record.completed) actions.append(el('button', {class: 'small', text: 'Mark watched', onClick: event => action(event.currentTarget, () => onComplete(record))}));
    if (onRemove) actions.append(el('button', {class: 'text-button danger', text: 'Remove local', onClick: event => action(event.currentTarget, () => onRemove(record))}));
    item.append(actions);
  }
  return item;
}
