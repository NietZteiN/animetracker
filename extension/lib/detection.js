/* A classic script so the exact same parser runs in content scripts and tests. */
(() => {
  const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const number = value => {
    const n = Number(String(value ?? '').trim());
    return Number.isInteger(n) && n > 0 && n <= 10000 ? n : null;
  };
  function parseLabel(value) {
    const text = String(value || '').replace(/[＿_]/g, ' ').slice(0, 500);
    const patterns = [
      /\bS(\d{1,2})\s*[-. ]?\s*E(?:P)?(\d{1,4})(?![\d.])/i,
      /\b(\d{1,2})x(\d{1,4})(?![\d.])/i
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) return {season: number(match[1]), episode: number(match[2]), index: match.index, end: match.index + match[0].length};
    }
    const ep = /\b(?:episode|ep\.?|e)\s*[-:#.]?\s*(\d{1,4})(?![\d.]|\s*\/)/i.exec(text)
      || /第\s*(\d{1,4})\s*[話集]/.exec(text);
    const season = /\b(?:season\s*|s)(\d{1,2})\b/i.exec(text)
      || /\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i.exec(text);
    return {season: season ? number(season[1]) : null, episode: ep ? number(ep[1]) : null, index: ep?.index ?? -1, end: ep ? ep.index + ep[0].length : -1};
  }
  function cleanTitle(value) {
    let text = String(value || '').replace(/\s+/g, ' ').trim();
    text = text.split(/\s+[|｜]\s+|\s+[–—]\s+(?=Watch\b)/i)[0];
    text = text.replace(/^(?:watch|watching|stream)\s+/i, '');
    const label = parseLabel(text);
    if (label.index >= 0) text = text.slice(0, label.index);
    text = text.replace(/\bseason\s*\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\s+season\b|\bS\d{1,2}\b/gi, ' ')
      .replace(/\b(?:english\s+)?(?:subbed|dubbed|sub|dub)\b/gi, ' ')
      .replace(/\b(?:online|free|full\s+episodes?|HD|1080p|720p)\b/gi, ' ')
      .replace(/\s*\([^\p{L}\p{N}]*\)\s*/gu, ' ')
      .replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, '').replace(/\s+/g, ' ').trim();
    return text.length >= 2 && text.length <= 180 && !/^(?:video|player|watch|episode|home|loading|anime)$/i.test(text) ? text : null;
  }
  function flattenJson(value, output = [], depth = 0) {
    if (depth > 7 || output.length > 150) return output;
    if (Array.isArray(value)) value.slice(0, 100).forEach(v => flattenJson(v, output, depth + 1));
    else if (value && typeof value === 'object') {
      output.push(value);
      for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item', 'subjectOf']) if (value[key]) flattenJson(value[key], output, depth + 1);
    }
    return output;
  }
  function detect(snapshot) {
    const candidates = [];
    for (const item of flattenJson(snapshot.structured || [])) {
      const types = [].concat(item['@type'] || []);
      if (!types.some(t => /(?:TVEpisode|Episode)$/.test(t))) continue;
      const title = cleanTitle(item.partOfSeries?.name || item.partOfSeason?.partOfSeries?.name || item.isPartOf?.name);
      const episode = number(item.episodeNumber) || parseLabel(item.name).episode;
      const season = number(item.partOfSeason?.seasonNumber) || parseLabel(item.partOfSeason?.name).season || parseLabel(item.name).season;
      if (title && episode) candidates.push({title, episode, season, confidence: 'high', source: 'Structured episode metadata', score: 100});
    }
    const texts = [snapshot.custom?.title, ...(snapshot.headings || []), snapshot.ogTitle, snapshot.documentTitle, snapshot.mediaTitle].filter(Boolean);
    const labels = [snapshot.custom?.episode, ...(snapshot.labels || []), ...texts].filter(Boolean).map(parseLabel);
    let urlTitle = '';
    let urlLabel = {};
    try {
      const url = new URL(snapshot.url);
      const slug = decodeURIComponent(url.pathname).replace(/[-_]+/g, ' ');
      urlLabel = parseLabel(slug);
      const epQuery = ['episode', 'ep', 'e'].map(k => number(url.searchParams.get(k))).find(Boolean);
      if (!urlLabel.episode && epQuery) urlLabel.episode = epQuery;
      if (!urlLabel.season) urlLabel.season = number(url.searchParams.get('season'));
      const segment = slug.split('/').filter(Boolean).findLast(s => parseLabel(s).episode);
      if (segment) urlTitle = cleanTitle(segment);
    } catch { /* non-HTTP frames may not have a parseable URL */ }
    const explicitEpisode = number(snapshot.custom?.episode);
    const episode = explicitEpisode || labels.find(l => l.episode)?.episode || urlLabel.episode;
    const season = number(snapshot.custom?.season) || parseLabel(snapshot.custom?.season).season || labels.find(l => l.season)?.season || urlLabel.season || null;
    if (episode) {
      for (const [index, value] of [...texts, urlTitle].entries()) {
        const title = cleanTitle(value);
        if (title) candidates.push({title, episode, season, confidence: parseLabel(value).episode ? 'high' : 'medium', source: index === 0 && snapshot.custom?.title ? 'Custom site rule' : 'Page title and episode labels', score: index === 0 && snapshot.custom?.title ? 120 : 80 - index + (parseLabel(value).episode ? 12 : 0)});
      }
    }
    return candidates.sort((a, b) => b.score - a.score)[0] || null;
  }
  function snapshot(doc, url, rule) {
    const text = selector => {
      try { const el = doc.querySelector(selector); return (el?.getAttribute('content') || el?.textContent || '').trim().slice(0, 500); } catch { return ''; }
    };
    const structured = [];
    for (const script of [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(0, 15)) {
      if (script.textContent.length > 250000) continue;
      try { structured.push(JSON.parse(script.textContent)); } catch { /* malformed publisher JSON */ }
    }
    return {
      url, documentTitle: doc.title, ogTitle: text('meta[property="og:title"]'),
      headings: [...doc.querySelectorAll('h1, [data-anime-title], [itemprop="partOfSeries"]')].slice(0, 8).map(el => el.getAttribute('data-anime-title') || el.textContent.trim().slice(0, 300)),
      labels: [...doc.querySelectorAll('[data-episode-number], [itemprop="episodeNumber"], [class*="episode"][aria-current="true"], [class*="episode"].active, .video-title, .episode-title')].slice(0, 10).map(el => el.hasAttribute('data-episode-number') ? `Episode ${el.getAttribute('data-episode-number')}` : el.textContent.trim().slice(0, 300)),
      structured,
      custom: rule ? {title: text(rule.titleSelector), episode: text(rule.episodeSelector), season: text(rule.seasonSelector)} : null
    };
  }
  globalThis.AnimeTrailDetection = {normalize, number, parseLabel, cleanTitle, detect, snapshot};
})();
