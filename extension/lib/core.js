import './detection.js';
export const {normalize, detect, snapshot, cleanTitle, parseLabel} = globalThis.AnimeTrailDetection;
export const defaults = Object.freeze({enabled: true, autoSync: true, resumePrompts: true, threshold: 80, minSeconds: 120, clientId: '', excludedHosts: [], rules: []});
export const seriesKey = item => `${normalize(item.title)}::${item.season || 1}`;
export const episodeKey = item => `${seriesKey(item)}::${item.episode}`;
export function safeUrl(raw) {
  try { const url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol)) return ''; url.hash = ''; return url.href.slice(0, 2000); } catch { return ''; }
}
export function excluded(host, hosts) {
  return hosts.some(entry => host === entry || host.endsWith(`.${entry}`));
}
export function mergeRanges(ranges, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return ranges || [];
  const sorted = [...(ranges || []), [start, end]].sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const range of sorted) {
    const previous = result.at(-1);
    if (previous && range[0] <= previous[1] + 0.25) previous[1] = Math.max(previous[1], range[1]);
    else result.push([...range]);
  }
  // Bound storage on unusually fragmented playback, keeping the longest segments.
  return result.length <= 300 ? result : result.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 300).sort((a, b) => a[0] - b[0]);
}
export function applyPlayback(record, sample, previous, settings, now) {
  const duration = Number(sample.duration);
  const position = Number(sample.position);
  if (!(duration >= 60 && duration <= 43200 && position >= 0 && position <= duration + 1)) return record;
  record.duration = duration;
  record.position = Math.min(position, duration);
  if (previous && previous.key === record.key && previous.mediaId === sample.mediaId && previous.playing && !sample.seeking) {
    const elapsed = (now - previous.at) / 1000;
    const delta = position - previous.position;
    const rate = Math.min(4, Math.max(0.25, Number(sample.rate) || 1));
    // Only continuous played intervals count. Seeking to the credits cannot complete an episode.
    if (elapsed > 0 && elapsed <= 20 && delta > 0 && delta <= elapsed * rate + 1.5) {
      record.ranges = mergeRanges(record.ranges, previous.position, position);
      record.playedSeconds = (record.playedSeconds || 0) + Math.min(elapsed, delta / rate);
    }
  }
  const covered = (record.ranges || []).reduce((sum, [a, b]) => sum + b - a, 0);
  record.coverage = Math.min(1, covered / duration);
  if (record.coverage >= settings.threshold / 100 && record.playedSeconds >= settings.minSeconds) record.completed = true;
  return record;
}
export function rankMatches(candidate, nodes) {
  const wanted = normalize(candidate.title);
  return nodes.map(node => {
    const titles = [node.title, node.alternative_titles?.en, node.alternative_titles?.ja, ...(node.alternative_titles?.synonyms || [])].filter(Boolean);
    let score = 0;
    let exact = false;
    for (const title of titles) {
      const label = parseLabel(title);
      const base = normalize(cleanTitle(title));
      const full = normalize(title);
      const same = base === wanted || full === wanted;
      const seasonFits = (candidate.season || 1) === (label.season || 1);
      // Later seasons without an explicit matching season label require a manual selection.
      if (same && seasonFits) { score = Math.max(score, 100); exact = true; }
      else if (same) score = Math.max(score, 65);
      else {
        const a = new Set(wanted.split(' ')), b = new Set(base.split(' '));
        const overlap = [...a].filter(t => b.has(t)).length;
        score = Math.max(score, 60 * overlap / Math.max(a.size, b.size));
      }
    }
    if (node.media_type && !['tv', 'ona'].includes(node.media_type)) { score -= 15; exact = false; }
    return {node, score, exact};
  }).sort((a, b) => b.score - a.score);
}
export function automaticMatch(candidate, nodes) {
  const ranked = rankMatches(candidate, nodes);
  return ranked[0]?.exact && (!ranked[1] || ranked[0].score - ranked[1].score >= 10) ? ranked[0].node : null;
}
export function syncPlan(detail, episode, completed, autoComplete = true) {
  if (!Number.isInteger(episode) || episode < 1) throw new Error('Episode must be a positive whole number. Specials need a manual MAL entry.');
  if (detail.num_episodes > 0 && episode > detail.num_episodes) throw new Error(`Episode ${episode} exceeds this MAL entry’s ${detail.num_episodes} episodes. Check the season or episode offset.`);
  const current = detail.my_list_status || {};
  const watched = Math.max(current.num_episodes_watched || 0, completed ? episode : 0);
  const status = current.status === 'completed' || (autoComplete && detail.num_episodes > 0 && watched >= detail.num_episodes) ? 'completed' : 'watching';
  if (current.status === status && (current.num_episodes_watched || 0) >= watched) return null;
  return {status, num_watched_episodes: watched};
}
