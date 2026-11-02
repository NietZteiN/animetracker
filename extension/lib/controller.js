import {seriesKey, episodeKey, safeUrl, excluded, applyPlayback, automaticMatch, syncPlan} from './core.js';
import {resumeOffer, playbackIdentity} from './resume.js';
const candidateValid = c => c && typeof c.title === 'string' && c.title.length >= 2 && c.title.length <= 180 && Number.isInteger(c.episode) && c.episode > 0 && c.episode <= 10000 && (c.season == null || (Number.isInteger(c.season) && c.season > 0 && c.season <= 99));
export class Controller {
  constructor(browserApi, store, mal) { this.browser = browserApi; this.store = store; this.mal = mal; this.syncing = null; }
  async config(sender) {
    const {settings} = await this.store.load();
    let host = '';
    try { host = new URL(sender.tab?.url || sender.url).hostname; } catch { /* restricted page */ }
    const frameHost = (() => { try { return new URL(sender.url).hostname; } catch { return host; } })();
    return {enabled: settings.enabled && !excluded(host, settings.excludedHosts) && !sender.tab?.incognito, resumePrompts: settings.resumePrompts, rule: settings.rules.find(r => r.hostname === frameHost) || null};
  }
  async observe(message, sender) {
    if (!sender.tab || !(await this.config(sender)).enabled) return {};
    const state = await this.store.load(), now = Date.now(), tabId = sender.tab.id;
    const url = safeUrl(sender.tab.url || (sender.frameId === 0 ? sender.url : ''));
    if (!url) return {};
    let session = await this.store.session(tabId);
    if (session.url !== url) session = {url, pendingResume: session.pendingResume};
    if (sender.frameId === 0) {
      const documentId = sender.documentId || message.documentId;
      if (documentId && session.topDocumentId !== documentId) {
        delete session.resumeContext; delete session.resumeOffer; delete session.resumeDecision;
        delete session.previous; delete session.owner; session.topDocumentId = documentId;
      }
      const next = candidateValid(message.candidate) ? message.candidate : null;
      if (session.manual && next) {
        if (session.manualBaseline && session.manualBaseline !== episodeKey(next)) delete session.manual;
        else session.manualBaseline = episodeKey(next);
      }
      if (episodeKey(next || {}) !== episodeKey(session.candidate || {})) { delete session.previous; delete session.owner; }
      session.candidate = next;
    }
    const candidate = session.manual || session.candidate || (candidateValid(message.candidate) ? message.candidate : null);
    if (candidate && session.resumeContext !== episodeKey(candidate)) {
      session.resumeContext = episodeKey(candidate);
      session.resumeOffer = state.settings.resumePrompts ? resumeOffer(state, candidate) : null;
      delete session.resumeDecision;
    }
    const sample = message.sample;
    if (candidate && sample && sample.playing && Number.isFinite(sample.duration) && sample.duration >= 60) {
      const owner = session.owner;
      // Prefer the longest active player so a short ad iframe cannot displace the episode.
      const mayOwn = !owner || owner.frameId === sender.frameId || now - owner.at > 15000 || sample.duration > owner.duration * 1.5;
      if (mayOwn) {
        if (owner && owner.frameId !== sender.frameId) delete session.previous;
        session.owner = {frameId: sender.frameId, at: now, duration: sample.duration, mediaId: String(sample.mediaId).slice(0, 150)};
        if (session.pendingResume?.expiresAt < now) delete session.pendingResume;
        const pending = session.pendingResume, identity = playbackIdentity(state, candidate);
        if (pending && pending.series === identity.series && pending.targetCanonical === identity.episode) {
          session.resumeOffer = null; session.resumeDecision = 'accepted';
          const result = await this.seek(tabId, session.owner, pending.position);
          if (result.ok) { delete session.pendingResume; delete session.previous; }
        }
        if (state.settings.resumePrompts && session.resumeOffer && !session.resumeDecision) {
          // Snapshot the previous visit before this sample updates its saved timestamp.
          if (session.resumeOffer.kind === 'seek' && sample.position >= session.resumeOffer.position - 10) session.resumeDecision = 'unneeded';
          else this.browser.tabs.sendMessage(tabId, {type: 'animeTrailResumeOffer', offer: session.resumeOffer}, {frameId: 0}).catch(() => {});
        }
        const key = episodeKey(candidate), group = seriesKey(candidate);
        const record = state.history[key] || {key, group, title: candidate.title, episode: candidate.episode, season: candidate.season, firstSeen: now, ranges: [], playedSeconds: 0, completed: false};
        record.url = url; record.hostname = new URL(url).hostname; record.lastSeen = now;
        record.source = candidate.source || 'Manual correction';
        applyPlayback(record, sample, session.previous, state.settings, now);
        // A player starting at zero must not erase the resume point while the
        // user is still deciding whether to continue or start here.
        if (session.resumeOffer?.kind === 'seek' && !session.resumeDecision) record.position = session.resumeOffer.position;
        state.history[key] = record;
        session.previous = {key, at: now, position: sample.position, playing: sample.playing, mediaId: String(sample.mediaId).slice(0, 150)};
        session.key = key;
        if (state.mappings[group]) this.enqueue(state, record);
        await this.store.save(state);
      }
    }
    await this.store.saveSession(tabId, session);
    return {};
  }
  async seek(tabId, owner, position) {
    if (!owner || !(position >= 0)) return {ok: false, error: 'The episode player is not ready. Start playback and try again.'};
    if (position === 0) return {ok: true};
    try {
      const result = await this.browser.tabs.sendMessage(tabId, {type: 'animeTrailSeek', mediaId: owner.mediaId, position}, {frameId: owner.frameId});
      return result?.ok ? result : {ok: false, error: result?.error || 'This player could not resume automatically. Use its timeline to resume at the saved time.'};
    } catch { return {ok: false, error: 'The player is no longer available. Start playback and try again.'}; }
  }
  async resumeAction(message, sender) {
    const config = await this.config(sender);
    if (!sender.tab || sender.frameId !== 0 || !config.enabled || !config.resumePrompts) throw new Error('Resume is unavailable on this page.');
    const tab = await this.browser.tabs.get(sender.tab.id), session = await this.store.session(tab.id);
    if (tab.incognito || session.url !== safeUrl(tab.url) || !session.resumeOffer || session.resumeOffer.id !== message.offerId || session.resumeDecision) throw new Error('This resume suggestion has expired. Reload the watch page.');
    const offer = session.resumeOffer;
    if (message.action === 'dismiss') {
      session.resumeDecision = 'dismissed';
      if (offer.kind === 'seek' && session.previous) {
        const state = await this.store.load(), record = state.history[session.previous.key];
        if (record) { record.position = session.previous.position; await this.store.save(state); }
      }
      await this.store.saveSession(tab.id, session); return {};
    }
    if (message.action === 'seek' && offer.kind === 'seek') {
      const result = await this.seek(tab.id, session.owner, offer.position);
      if (!result.ok) throw new Error(result.error);
      session.resumeDecision = 'accepted'; delete session.previous;
      await this.store.saveSession(tab.id, session); return {};
    }
    if (message.action === 'navigate') {
      const url = safeUrl(message.url);
      if (!url || new URL(url).origin !== new URL(session.url).origin && url !== offer.savedUrl) throw new Error('The resume link is not valid for this suggestion.');
      session.pendingResume = {series: offer.series, targetCanonical: offer.targetCanonical, position: offer.position, expiresAt: Date.now() + 300000};
      session.resumeDecision = 'accepted'; delete session.previous;
      await this.store.saveSession(tab.id, session);
      await this.browser.tabs.update(tab.id, {url}); return {};
    }
    throw new Error('Unknown resume action.');
  }
  enqueue(state, record) {
    const mapping = state.mappings[record.group];
    if (!mapping || record.synced?.malId === mapping.id && record.synced?.completed >= Number(record.completed)) return;
    const target = record.episode + (mapping.offset || 0);
    if (!Number.isInteger(target) || target < 1) { record.error = 'The episode offset produces an invalid episode number.'; return; }
    const existing = state.queue[record.key];
    state.queue[record.key] = {key: record.key, malId: mapping.id, episode: target, completed: !!record.completed, attempts: existing?.attempts || 0, nextAt: existing?.nextAt || 0};
  }
  sync(force = false) {
    if (this.syncing) return this.syncing;
    this.syncing = this.performSync(force).finally(() => { this.syncing = null; });
    return this.syncing;
  }
  async performSync(force) {
    const allowed = state => state.settings.enabled && (state.settings.autoSync || force);
    let state = await this.store.run(() => this.store.load());
    if (!allowed(state) || !await this.mal.auth()) return {pending: Object.keys(state.queue).length};
    // Network requests run outside the storage lock. Playback and settings stay responsive
    // when MAL is offline, and each result merges into the latest state atomically.
    const candidates = Object.values(state.history).sort((a, b) => b.lastSeen - a.lastSeen)
      .filter(r => !state.mappings[r.group] && (force || !r.lastMatchAttempt || Date.now() - r.lastMatchAttempt >= 3600000));
    const groups = new Set();
    for (const record of candidates) {
      if (groups.has(record.group)) continue;
      if (groups.size >= 2) break;
      groups.add(record.group);
      const claimed = await this.store.run(async () => {
        const latest = await this.store.load();
        if (!allowed(latest) || !latest.history[record.key] || latest.mappings[record.group]) return false;
        for (const other of Object.values(latest.history).filter(r => r.group === record.group)) other.lastMatchAttempt = Date.now();
        await this.store.save(latest); return true;
      });
      if (!claimed) continue;
      let match, error;
      try {
        const nodes = await this.mal.search(`${record.title}${record.season > 1 ? ` season ${record.season}` : ''}`);
        match = automaticMatch(record, nodes);
      } catch (failure) { error = failure.message; }
      await this.store.run(async () => {
        const latest = await this.store.load();
        if (!allowed(latest) || !latest.history[record.key] || latest.mappings[record.group]) return;
        if (error) latest.history[record.key].error = error;
        else {
          delete latest.history[record.key].error;
          if (match) {
            latest.mappings[record.group] = {id: match.id, title: match.title, numEpisodes: match.num_episodes || 0, offset: 0, automatic: true};
            for (const other of Object.values(latest.history).filter(r => r.group === record.group)) this.enqueue(latest, other);
          }
        }
        await this.store.save(latest);
      });
    }
    state = await this.store.run(() => this.store.load());
    const jobs = Object.values(state.queue).filter(item => force || item.nextAt <= Date.now()).slice(0, 4);
    const sameJob = (a, b) => a && b && a.malId === b.malId && a.episode === b.episode && a.completed === b.completed;
    const valid = (latest, item) => {
      const record = latest.history[item.key], mapping = record && latest.mappings[record.group];
      return record && mapping?.id === item.malId && record.episode + (mapping.offset || 0) === item.episode && sameJob(latest.queue[item.key], item);
    };
    for (const item of jobs) {
      let latest = await this.store.run(() => this.store.load());
      if (!allowed(latest)) break;
      if (!valid(latest, item)) continue;
      let error;
      try {
        const detail = await this.mal.detail(item.malId);
        const plan = syncPlan(detail, item.episode, item.completed);
        latest = await this.store.run(() => this.store.load());
        if (!allowed(latest) || !valid(latest, item)) continue;
        if (plan) await this.mal.update(item.malId, plan);
      } catch (failure) { error = failure.message; }
      await this.store.run(async () => {
        const current = await this.store.load();
        if (!valid(current, item)) return; // A correction/removal/newer episode completion won the race.
        const record = current.history[item.key];
        if (error) {
          record.error = error;
          const queued = current.queue[item.key];
          queued.attempts++;
          queued.nextAt = Date.now() + Math.min(21600000, 60000 * 2 ** Math.min(queued.attempts, 8));
        } else {
          record.synced = {malId: item.malId, completed: Number(item.completed), at: Date.now()};
          delete record.error; delete current.queue[item.key];
        }
        await this.store.save(current);
      });
    }
    return {pending: Object.keys((await this.store.run(() => this.store.load())).queue).length};
  }
  async view(tabId) {
    const state = await this.store.load(), auth = await this.mal.auth();
    let session = tabId != null ? await this.store.session(tabId) : {};
    if (tabId != null) {
      try {
        const tab = await this.browser.tabs.get(tabId);
        if (session.url !== safeUrl(tab.url) || tab.incognito || excluded(new URL(tab.url).hostname, state.settings.excludedHosts)) session = {};
      } catch { session = {}; }
    }
    let current = session.manual || session.candidate || (session.key && state.history[session.key]) || null;
    if (current) {
      const key = episodeKey(current);
      current = {...current, ...state.history[key], key, group: seriesKey(current)};
    }
    const history = Object.values(state.history).sort((a, b) => b.lastSeen - a.lastSeen);
    return {settings: state.settings, connected: !!auth, user: auth?.user, redirectUri: this.browser.identity.getRedirectURL(), current, history, mappings: state.mappings, pending: Object.keys(state.queue).length};
  }
  async settings(input) {
    const state = await this.store.load();
    const next = {...state.settings};
    for (const key of ['enabled', 'autoSync', 'resumePrompts']) if (typeof input[key] === 'boolean') next[key] = input[key];
    if (input.clientId != null) {
      const id = String(input.clientId).trim();
      if (id && !/^[a-zA-Z0-9_-]{8,150}$/.test(id)) throw new Error('The Client ID format is invalid.');
      if (id !== next.clientId) await this.mal.disconnect();
      next.clientId = id;
    }
    if (input.threshold != null) {
      if (!Number.isInteger(input.threshold) || input.threshold < 50 || input.threshold > 100) throw new Error('Watch threshold must be between 50 and 100%.');
      next.threshold = input.threshold;
    }
    if (input.minSeconds != null) {
      if (!Number.isInteger(input.minSeconds) || input.minSeconds < 30 || input.minSeconds > 1800) throw new Error('Minimum playback must be between 30 and 1800 seconds.');
      next.minSeconds = input.minSeconds;
    }
    if (input.excludedHosts != null) {
      if (!Array.isArray(input.excludedHosts) || input.excludedHosts.length > 200 || input.excludedHosts.some(h => typeof h !== 'string' || !/^[a-z0-9.-]+$/.test(h))) throw new Error('Enter hostnames only, one per line, without https:// or paths.');
      next.excludedHosts = [...new Set(input.excludedHosts)];
    }
    if (input.rules != null) {
      if (!Array.isArray(input.rules) || input.rules.length > 100) throw new Error('Site rules must be a JSON array of up to 100 rules.');
      next.rules = input.rules.map(r => {
        if (!r || typeof r.hostname !== 'string' || !/^[a-z0-9.-]+$/.test(r.hostname) || !r.titleSelector || !r.episodeSelector) throw new Error('Each rule needs a hostname, titleSelector and episodeSelector.');
        const rule = {hostname: r.hostname};
        for (const key of ['titleSelector', 'episodeSelector', 'seasonSelector']) if (r[key]) {
          if (typeof r[key] !== 'string' || r[key].length > 500) throw new Error('Selectors must be strings shorter than 500 characters.');
          // Background runs in an event page, so the browser's CSS parser is available.
          try { globalThis.document?.querySelector(r[key]); } catch { throw new Error(`Invalid CSS selector: ${r[key]}`); }
          rule[key] = r[key];
        }
        return rule;
      });
    }
    state.settings = next;
    await this.store.save(state);
    return next;
  }
  async correct(message) {
    if (!candidateValid(message.candidate)) throw new Error('Enter a title, a positive whole episode number, and an optional season.');
    const tab = await this.browser.tabs.get(message.tabId);
    const url = safeUrl(tab.url);
    const state = await this.store.load();
    if (!url || tab.incognito || excluded(new URL(url).hostname, state.settings.excludedHosts)) throw new Error('Tracking is unavailable on this page.');
    const session = await this.store.session(message.tabId);
    const candidate = {...message.candidate, source: 'Manual correction'};
    const key = episodeKey(candidate), group = seriesKey(candidate);
    state.history[key] ||= {key, group, ...candidate, firstSeen: Date.now(), lastSeen: Date.now(), url, hostname: new URL(url).hostname, ranges: [], playedSeconds: 0, completed: false};
    await this.store.saveSession(message.tabId, {url, manual: candidate, manualBaseline: session.candidate ? episodeKey(session.candidate) : null, candidate: session.candidate || null, key});
    await this.store.save(state);
    return {key};
  }
  async link(message) {
    const state = await this.store.load(), record = state.history[message.key];
    if (!record) throw new Error('Start playback or save a correction before linking a title.');
    if (!Number.isInteger(message.offset) || Math.abs(message.offset) > 10000) throw new Error('Episode offset must be a whole number.');
    const detail = await this.mal.detail(Number(message.malId));
    syncPlan(detail, record.episode + message.offset, false);
    state.mappings[record.group] = {id: detail.id, title: detail.title, numEpisodes: detail.num_episodes || 0, offset: message.offset, automatic: false};
    for (const other of Object.values(state.history).filter(r => r.group === record.group)) { delete other.synced; delete other.error; this.enqueue(state, other); }
    await this.store.save(state);
    return {};
  }
  async complete(key) {
    const state = await this.store.load(), record = state.history[key];
    if (!record) throw new Error('Play the episode or save a correction first.');
    record.completed = true;
    this.enqueue(state, record);
    await this.store.save(state);
    return {};
  }
  async remove(key) {
    const state = await this.store.load();
    delete state.history[key]; delete state.queue[key];
    await this.store.save(state);
    return {};
  }
}
