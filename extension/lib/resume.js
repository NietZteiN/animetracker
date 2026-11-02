import {seriesKey, episodeKey, safeUrl} from './core.js';

export function playbackIdentity(state, item) {
  const group = item.group || seriesKey(item), mapping = state.mappings[group];
  return {series: mapping ? `mal:${mapping.id}` : `local:${group}`, episode: item.episode + (mapping?.offset || 0)};
}

function localResumeOffer(state, candidate) {
  const current = playbackIdentity(state, candidate);
  const meaningful = record => record.completed || (record.position >= 15 && ((record.playedSeconds || 0) >= 10 || (record.ranges || []).reduce((sum, [a, b]) => sum + b - a, 0) >= 10));
  const last = Object.values(state.history).filter(record => meaningful(record) && playbackIdentity(state, record).series === current.series)
    .sort((a, b) => b.lastSeen - a.lastSeen || b.episode - a.episode)[0];
  if (!last) return null;
  const identity = playbackIdentity(state, last);
  const mapping = state.mappings[candidate.group || seriesKey(candidate)];
  if (last.completed && mapping?.numEpisodes > 0 && identity.episode >= mapping.numEpisodes) return null;
  const targetCanonical = identity.episode + (last.completed ? 1 : 0);
  const targetEpisode = targetCanonical - (mapping?.offset || 0);
  if (!Number.isInteger(targetEpisode) || targetEpisode < 1 || targetEpisode > 10000) return null;
  if (last.completed && current.episode === targetCanonical) return null;
  const position = last.completed ? 0 : Math.max(0, Math.min(last.position || 0, (last.duration || Infinity) - 2));
  if (current.episode === targetCanonical && position < 15) return null;
  return {
    id: `${episodeKey(candidate)}|${last.key}|${last.lastSeen}|${last.completed ? 'next' : 'resume'}`,
    kind: current.episode === targetCanonical ? 'seek' : last.completed ? 'next' : 'episode',
    title: candidate.title, season: candidate.season, currentEpisode: candidate.episode,
    targetEpisode, targetCanonical, series: current.series,
    position, duration: last.duration || 0, savedUrl: safeUrl(last.url),
    lastEpisode: identity.episode - (mapping?.offset || 0), savedTitle: last.title
  };
}

export function resumeOffer(state, candidate) {
  const local = localResumeOffer(state, candidate);
  const group = candidate.group || seriesKey(candidate), mapping = state.mappings[group];
  const entry = mapping && state.malProgress?.anime?.[mapping.id];
  if (!entry) return local;
  const status = entry.list_status, count = status?.num_episodes_watched;
  if (!Number.isInteger(count) || count < 1 || status.status === 'completed' && !status.is_rewatching || entry.num_episodes > 0 && count >= entry.num_episodes) return local?.targetCanonical > count ? local : null;
  const targetCanonical = count + 1, targetEpisode = targetCanonical - (mapping.offset || 0);
  // Keep this PC's timestamp for the next unwatched episode, and retain locally
  // newer progress that has not reached MAL yet. Older local data must not win.
  if (local && local.targetCanonical >= targetCanonical) return local;
  if (candidate.episode + (mapping.offset || 0) === targetCanonical || targetEpisode < 1 || targetEpisode > 10000) return null;
  return {id: `mal:${state.malProgress.userId}:${mapping.id}:${count}:${episodeKey(candidate)}`,
    source: 'mal', userId: state.malProgress.userId, kind: 'next', title: candidate.title, season: candidate.season,
    currentEpisode: candidate.episode, targetEpisode, targetCanonical, series: `mal:${mapping.id}`,
    position: 0, duration: 0, savedUrl: '', lastEpisode: count - (mapping.offset || 0), savedTitle: entry.title};
}
