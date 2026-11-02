(() => {
  const {parseLabel, normalize, cleanTitle} = globalThis.AnimeTrailDetection;
  const stamp = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const make = (tag, text, attributes = {}) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };
  function episodeLink(offer) {
    const links = [];
    for (const anchor of [...document.querySelectorAll('a[href]')].slice(0, 3000)) {
      let url;
      try { url = new URL(anchor.getAttribute('href'), location.href); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin || url.href === location.href) continue;
      const text = (anchor.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.textContent || '').trim();
      const data = anchor.getAttribute('data-episode-number') || anchor.getAttribute('data-episode');
      const label = parseLabel(text), pathLabel = parseLabel(decodePath(url.pathname));
      const inEpisodes = anchor.closest('[class*="episode"], [id*="episode"], [aria-label*="pisode"]');
      const number = label.episode || (data && /^\d+$/.test(data) ? Number(data) : null) || (inEpisodes && /^\d+$/.test(text) ? Number(text) : null) || pathLabel.episode;
      if (number !== offer.targetEpisode || offer.season && (label.season || pathLabel.season) && (label.season || pathLabel.season) !== offer.season) continue;
      if (!inEpisodes && !label.episode && !data) continue;
      // Explicit titles for other shows must not hijack a generic episode number.
      const named = cleanTitle(text);
      if (named && label.episode && normalize(named) !== normalize(offer.title) && !/^(?:episode|ep|watch|play|next|previous)\b/i.test(named)) continue;
      links.push({url: url.href, score: (inEpisodes ? 4 : 0) + (label.episode ? 2 : 0) + (data ? 2 : 0)});
    }
    links.sort((a, b) => b.score - a.score);
    if (!links.length || links[1]?.score === links[0].score && links[1].url !== links[0].url) return null;
    return links[0].url;
  }
  function decodePath(path) { try { return decodeURIComponent(path).replace(/[-_]/g, ' '); } catch { return path; } }
  let host, activeId;
  const mount = () => {
    const full = document.fullscreenElement;
    const parent = full && !['VIDEO', 'IFRAME', 'AUDIO'].includes(full.tagName) ? full : document.documentElement;
    if (host && host.parentNode !== parent) parent.append(host);
  };
  document.addEventListener('fullscreenchange', mount);
  function hide() { host?.remove(); host = null; activeId = null; }
  function show(offer) {
    if (!offer || host?.isConnected && activeId === offer.id) return;
    hide(); activeId = offer.id;
    const siteUrl = offer.kind === 'seek' ? null : episodeLink(offer);
    const destination = siteUrl || (offer.savedUrl !== location.href ? offer.savedUrl : null);
    host = make('div', '', {'data-anime-trail-resume': ''});
    host.style.cssText = 'all:initial!important;position:fixed!important;right:20px!important;bottom:20px!important;z-index:2147483647!important;width:min(380px,calc(100vw - 40px))!important;display:block!important;';
    const root = host.attachShadow({mode: 'open'});
    const style = make('style');
    style.textContent = ':host{color-scheme:dark}*{box-sizing:border-box}.card{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#19212d;color:#eff4f7;border:1px solid #536746;border-radius:16px;padding:20px;box-shadow:0 12px 55px #0009;text-align:left}header{display:flex;justify-content:space-between;align-items:center;gap:12px}.brand{color:#b6f07b;font-size:11px;font-weight:750;letter-spacing:1.5px;text-transform:uppercase}h2{font-size:21px;line-height:1.2;letter-spacing:-.4px;margin:12px 0 8px}p{margin:0;color:#adbdce;overflow-wrap:anywhere}.title{color:#eff4f7;font-weight:650;margin-bottom:6px}.actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:18px}button{font:inherit;font-weight:650;cursor:pointer;border-radius:9px;border:1px solid #384657;padding:10px 12px;color:#eff4f7;background:transparent}button:focus-visible{outline:2px solid #b6f07b;outline-offset:3px}button:hover{filter:brightness(1.15)}button:disabled{opacity:.6;cursor:wait}.primary{background:#b6f07b;color:#172410;border-color:#b6f07b}.close{font-size:22px;line-height:1;border:0;padding:0 3px;color:#adbdce}.note{font-size:11px;margin-top:12px}.error{margin-top:10px;color:#ffb4aa;font-size:12px}';
    const card = make('section', '', {class: 'card', role: 'dialog', 'aria-label': 'Continue where you left off'});
    const header = make('header'), close = make('button', '×', {class: 'close', 'aria-label': 'Dismiss resume suggestion'});
    header.append(make('span', 'Anime Trail', {class: 'brand'}), close);
    const heading = make('h2', 'Continue where you left off?');
    const title = make('p', `${offer.title}${offer.season ? ` · Season ${offer.season}` : ''}`, {class: 'title'});
    const description = make('p', offer.kind === 'seek' ? `Resume episode ${offer.targetEpisode} at ${stamp(offer.position)}.` : offer.kind === 'next' ? `You’re on episode ${offer.currentEpisode}. You last finished episode ${offer.lastEpisode}; episode ${offer.targetEpisode} is next.` : `You’re on episode ${offer.currentEpisode}. You left off in episode ${offer.targetEpisode} at ${stamp(offer.position)}.`);
    const actions = make('div', '', {class: 'actions'}), primary = make('button', offer.kind === 'seek' ? `Resume at ${stamp(offer.position)}` : siteUrl ? `Continue episode ${offer.targetEpisode}` : offer.kind === 'next' ? 'Open last watch page' : 'Open saved episode', {class: 'primary'});
    const stay = make('button', offer.kind === 'seek' ? 'Start here' : `Stay on episode ${offer.currentEpisode}`);
    const error = make('p', '', {class: 'error', role: 'status'}); error.hidden = true;
    const act = async (button, payload) => {
      button.disabled = true; error.hidden = true;
      try {
        const response = await browser.runtime.sendMessage({type: 'resumeAction', offerId: offer.id, ...payload});
        if (!response?.ok) throw new Error(response?.error || 'Resume is unavailable. Try again after playback starts.');
        hide();
      } catch (failure) { error.textContent = failure.message; error.hidden = false; button.disabled = false; }
    };
    primary.addEventListener('click', () => act(primary, offer.kind === 'seek' ? {action: 'seek'} : {action: 'navigate', url: destination}));
    stay.addEventListener('click', () => act(stay, {action: 'dismiss'}));
    close.addEventListener('click', () => act(close, {action: 'dismiss'}));
    card.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); act(close, {action: 'dismiss'}); } });
    if (offer.kind === 'seek' || destination) actions.append(primary);
    actions.append(stay);
    card.append(header, heading, title, description, actions, error);
    if (!siteUrl && offer.kind !== 'seek') {
      let note = destination ? `Opens your saved page on ${new URL(destination).hostname}.` : 'Choose the saved episode in this site’s episode selector.';
      if (offer.kind === 'next' && destination) note += ' Use its episode selector to continue with the next episode.';
      card.append(make('p', note, {class: 'note'}));
    }
    root.append(style, card);
    mount();
  }
  globalThis.AnimeTrailResumeUI = {show, hide, episodeLink};
})();
