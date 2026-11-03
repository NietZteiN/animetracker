(() => {
  const {browser, onMessage} = globalThis.AnimeTrailBrowser;
  if (globalThis.__animeTrailLoaded) return;
  globalThis.__animeTrailLoaded = true;
  const {detect, snapshot} = globalThis.AnimeTrailDetection;
  // randomUUID is restricted to secure contexts; HTTP streaming pages still work.
  const uniqueId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const documentId = uniqueId();
  let config = {enabled: false}, configured = false, configuring = false, lastScanError = '', lastFingerprint = '', busy = false, scanTimer, pageContext = '', lastVideo;
  const players = new WeakMap();
  const mediaId = video => `${documentId}:${players.get(video)}:${video.currentSrc}`.slice(0, 150);
  function videos(root = document, result = []) {
    for (const video of root.querySelectorAll('video')) result.push(video);
    // Some players put the <video> in an open shadow root.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node, visited = 0;
    while ((node = walker.nextNode()) && visited++ < 5000) if (node.shadowRoot) videos(node.shadowRoot, result);
    return result;
  }
  async function scan(force = false) {
    if (!config.enabled || busy) return;
    busy = true;
    try {
      const candidate = detect(snapshot(document, location.href, config.rule));
      if (window === window.top) {
        const context = JSON.stringify([location.href, candidate?.title, candidate?.season, candidate?.episode]);
        if (context !== pageContext) globalThis.AnimeTrailResumeUI.hide();
        pageContext = context;
      }
      const eligible = videos().filter(v => v.readyState >= 2 && Number.isFinite(v.duration) && v.duration >= 60);
      const video = eligible.filter(v => !v.paused && !v.ended).sort((a, b) => b.duration - a.duration)[0]
        // Capture the end of short play/pause cycles, including subtitle auto-pause.
        // An initially paused player must not create watched history by itself.
        || (force && eligible.includes(lastVideo) ? lastVideo : null);
      let sample = null;
      if (video) {
        lastVideo = video;
        if (!players.has(video)) players.set(video, uniqueId());
        sample = {mediaId: mediaId(video), duration: video.duration, position: video.currentTime, rate: video.playbackRate, playing: !video.paused && !video.ended, seeking: video.seeking};
      }
      const fingerprint = JSON.stringify({candidate, url: location.href});
      if (force || sample || fingerprint !== lastFingerprint) {
        const result = await browser.runtime.sendMessage({type: 'observe', candidate, sample, documentId});
        if (result && !result.ok) console.warn('Anime Trail:', result.error);
        if (result?.ok) lastFingerprint = fingerprint;
      }
      lastScanError = '';
    } catch (error) { lastScanError = error.message; console.debug('Anime Trail scan:', error.message); }
    finally { busy = false; }
  }
  onMessage((message, sender) => {
    if (sender.id !== browser.runtime.id) return undefined;
    if (message.type === 'animeTrailStatus') {
      const found = videos();
      return Promise.resolve({ok: true, configured, enabled: config.enabled, videoCount: found.length,
        playingCount: found.filter(v => !v.paused && !v.ended).length,
        trackableCount: found.filter(v => !v.paused && !v.ended && v.readyState >= 2 && Number.isFinite(v.duration) && v.duration >= 60).length,
        scanFailed: !!lastScanError});
    }
    if (!config.enabled) return undefined;
    if (message.type === 'animeTrailResumeOffer' && config.resumePrompts && window === window.top) {
      if (message.offer) globalThis.AnimeTrailResumeUI.show(message.offer); else globalThis.AnimeTrailResumeUI.hide();
      return Promise.resolve({ok: true});
    }
    if (message.type !== 'animeTrailSeek') return undefined;
    const video = videos().find(v => players.has(v) && mediaId(v) === message.mediaId);
    if (!video || video.readyState < 1 || !Number.isFinite(video.duration) || !(message.position >= 0)) return Promise.resolve({ok: false, error: 'The episode player is not ready to resume. Start playback and retry.'});
    const target = Math.min(message.position, video.duration - 2);
    return new Promise(resolve => {
      let timer;
      const finish = () => {
        clearTimeout(timer); video.removeEventListener('seeked', finish);
        const ok = Math.abs(video.currentTime - target) < 3;
        resolve(ok ? {ok: true} : {ok: false, error: 'This player blocked seeking. Use its timeline to jump to your saved time.'});
      };
      video.addEventListener('seeked', finish, {once: true});
      timer = setTimeout(finish, 5000);
      try { video.currentTime = target; video.play().catch(() => {}); } catch { finish(); }
    });
  });
  async function configure() {
    if (configuring) return;
    configuring = true;
    try { const result = await browser.runtime.sendMessage({type: 'contentConfig'}); if (result?.ok) { config = result.data; configured = true; } if (!config.enabled || !config.resumePrompts) globalThis.AnimeTrailResumeUI.hide(); await scan(true); } catch (error) { console.debug('Anime Trail configuration:', error.message); }
    finally { configuring = false; }
  }
  browser.storage.onChanged.addListener(changes => {
    if (changes.state && JSON.stringify(changes.state.oldValue?.settings) !== JSON.stringify(changes.state.newValue?.settings)) configure();
  });
  // Debounce title/player changes without scanning a page on every DOM mutation.
  new MutationObserver(() => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 1000);
  }).observe(document.documentElement, {childList: true, subtree: true, characterData: true});
  for (const event of ['play', 'playing', 'pause', 'ended', 'seeked', 'loadedmetadata']) document.addEventListener(event, () => scan(true), true);
  addEventListener('popstate', () => scan(true));
  addEventListener('pageshow', () => scan(true));
  setInterval(() => configured ? scan() : configure(), 5000);
  configure();
})();
