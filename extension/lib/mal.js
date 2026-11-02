const API = 'https://api.myanimelist.net/v2';
const AUTH = 'https://myanimelist.net/v1/oauth2';
const ORIGINS = ['https://myanimelist.net/*', 'https://api.myanimelist.net/*'];
const endpointName = url => url.startsWith(`${AUTH}/token`) ? 'MAL token endpoint' : url.startsWith(`${API}/users/@me`) ? 'MAL profile endpoint' : 'MAL anime API';
const randomString = () => Array.from(crypto.getRandomValues(new Uint8Array(48)), b => b.toString(16).padStart(2, '0')).join('');
export class MalClient {
  // Invoke native fetch as a global function. Assigning it directly and calling
  // this.fetcher(...) makes Firefox interpret the client as a Window receiver.
  constructor(browserApi, fetcher = (...args) => fetch(...args)) { this.browser = browserApi; this.fetcher = fetcher; this.refreshing = null; this.authorizing = false; this.generation = 0; }
  async auth() { return (await this.browser.storage.local.get('auth')).auth || null; }
  async disconnect() { this.generation++; await this.browser.storage.local.remove('auth'); }
  async checkPermission(url) {
    const origin = `${new URL(url).origin}/*`;
    if (this.browser.permissions?.contains && !await this.browser.permissions.contains({origins: [origin]})) {
      const error = new Error(`${endpointName(url)} is blocked because Anime Trail lacks access to ${new URL(url).hostname}. Open about:addons → Anime Trail → Permissions and data, allow MyAnimeList website access, then retry. Your watch history is saved.`);
      error.code = 'MAL_HOST_PERMISSION';
      throw error;
    }
  }
  async fetchResponse(url, options = {}) {
    await this.checkPermission(url);
    try {
      return await this.fetcher(url, {...options, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000)});
    } catch (cause) {
      const timedOut = ['TimeoutError', 'AbortError'].includes(cause?.name);
      const blocked = cause?.name === 'SecurityError';
      // Keep diagnostics useful without echoing URLs, OAuth codes, tokens or response bodies.
      const browserError = ['TypeError', 'NetworkError', 'SecurityError', 'TimeoutError', 'AbortError'].includes(cause?.name) ? cause.name : 'NetworkError';
      const error = new Error(timedOut ? `${endpointName(url)} timed out after 30 seconds. Check your connection and try again. Your watch history is saved.` : `${endpointName(url)} request ${blocked ? 'was blocked by the browser' : 'failed before an HTTP response'} (${browserError}). Use Test connection in Settings to check MAL access. If it still fails, check whether a VPN, proxy, DNS filter or browser blocker is blocking ${new URL(url).hostname}. Your watch history is saved.`);
      error.code = timedOut ? 'MAL_TIMEOUT' : blocked ? 'MAL_BROWSER_BLOCKED' : 'MAL_NETWORK';
      throw error;
    }
  }
  async json(url, options = {}) {
    const response = await this.fetchResponse(url, options);
    let data;
    try { data = await response.json(); } catch {
      const error = new Error(`${endpointName(url)} returned ${response.status === 403 ? 'an access-denied or browser-verification page' : 'a non-JSON response'} (HTTP ${response.status}). Open myanimelist.net in a tab to check whether it is showing a verification or network error, then retry. Your watch history is saved.`);
      error.status = response.status; throw error;
    }
    if (!response.ok) {
      // Do not echo provider response bodies: OAuth errors may contain private values.
      const error = new Error(response.status === 401 ? url.startsWith(`${AUTH}/token`) ? 'MAL rejected the token exchange (HTTP 401). Check that the API app type is other, the Client ID is correct, and its redirect URL exactly matches Settings. Then start a fresh connection.' : 'MyAnimeList login expired. Reconnect in Settings.' : response.status === 429 ? 'MyAnimeList rate limit reached. Sync will retry later.' : `${endpointName(url)} request failed (HTTP ${response.status}). Check the client ID, app type and redirect URL in Settings.`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async token(body) {
    const result = await this.json(`${AUTH}/token`, {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body).toString()});
    if (!result.access_token || !result.refresh_token || !(result.expires_in > 0)) throw new Error('MyAnimeList did not return a valid token. Reconnect in Settings.');
    return {accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt: Date.now() + result.expires_in * 1000};
  }
  async connect(clientId) {
    if (this.authorizing) throw new Error('A MyAnimeList login window is already open.');
    if (!/^[a-zA-Z0-9_-]{8,150}$/.test(clientId)) throw new Error('Save your MyAnimeList Client ID first.');
    for (const origin of ORIGINS) await this.checkPermission(origin);
    this.authorizing = true;
    const generation = ++this.generation;
    try {
      const redirectUri = this.browser.identity.getRedirectURL();
      const verifier = randomString(), state = randomString();
      const url = new URL(`${AUTH}/authorize`);
      url.search = new URLSearchParams({response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: verifier, code_challenge_method: 'plain', state}).toString();
      const redirect = new URL(await this.browser.identity.launchWebAuthFlow({url: url.href, interactive: true}));
      const expected = new URL(redirectUri);
      if (redirect.origin !== expected.origin || redirect.pathname !== expected.pathname || redirect.searchParams.get('state') !== state) throw new Error('MyAnimeList login response could not be verified. Please try again.');
      if (redirect.searchParams.has('error') || !redirect.searchParams.get('code')) throw new Error('MyAnimeList authorization was not completed.');
      const tokens = await this.token({grant_type: 'authorization_code', client_id: clientId, code: redirect.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirectUri});
      const user = await this.json(`${API}/users/@me`, {headers: {Authorization: `Bearer ${tokens.accessToken}`}});
      if (generation !== this.generation) throw new Error('Login was cancelled.');
      await this.browser.storage.local.set({auth: {...tokens, clientId, user: {id: user.id, name: user.name}}});
      return {id: user.id, name: user.name};
    } finally { this.authorizing = false; }
  }
  async testConnection() {
    const saved = await this.auth();
    const probes = [
      {name: 'Login server', url: `${AUTH}/token`},
      {name: 'Anime API', url: `${API}/users/@me`, headers: saved?.accessToken ? {Authorization: `Bearer ${saved.accessToken}`} : {}}
    ];
    return Promise.all(probes.map(async probe => {
      try {
        const response = await this.fetchResponse(probe.url, {method: 'GET', headers: probe.headers || {}});
        // 401/403 without a token and 405 on GET /token are expected. Any HTTP
        // response proves a connection, but does not prove that login is valid.
        const result = {name: probe.name, host: new URL(probe.url).hostname, reachable: true, status: response.status};
        if (probe.name === 'Anime API' && saved?.accessToken) result.authenticated = response.ok;
        return result;
      } catch (error) {
        return {name: probe.name, host: new URL(probe.url).hostname, reachable: false, error: error.message, code: error.code};
      }
    }));
  }
  async refresh(force = false) {
    if (this.refreshing) return this.refreshing;
    const existing = await this.auth();
    if (this.refreshing) return this.refreshing;
    if (!existing) throw new Error('Connect MyAnimeList in Settings to sync your progress.');
    if (!force && existing.expiresAt > Date.now() + 60000) return existing;
    const generation = this.generation;
    this.refreshing = (async () => {
      const tokens = await this.token({grant_type: 'refresh_token', client_id: existing.clientId, refresh_token: existing.refreshToken});
      if (generation !== this.generation) throw new Error('MyAnimeList was disconnected.');
      const next = {...existing, ...tokens};
      await this.browser.storage.local.set({auth: next});
      return next;
    })();
    try { return await this.refreshing; } finally { this.refreshing = null; }
  }
  async request(path, options = {}) {
    let auth = await this.refresh();
    const request = () => this.json(`${API}${path}`, {...options, headers: {...options.headers, Authorization: `Bearer ${auth.accessToken}`}});
    try { return await request(); }
    catch (error) { if (error.status !== 401) throw error; auth = await this.refresh(true); return request(); }
  }
  async search(query) {
    const q = String(query || '').trim().slice(0, 64);
    if (q.length < 2) throw new Error('Enter at least two characters to search.');
    const params = new URLSearchParams({q, limit: '20', nsfw: 'true', fields: 'alternative_titles,num_episodes,media_type,start_season'});
    return (await this.request(`/anime?${params}`)).data.map(item => item.node);
  }
  async detail(id) {
    if (!Number.isInteger(id) || id < 1) throw new Error('Enter a valid MAL anime ID.');
    return this.request(`/anime/${id}?fields=alternative_titles,num_episodes,media_type,my_list_status,start_season`);
  }
  async watchList() {
    const entries = new Map();
    let offset = 0;
    for (let page = 0; page < 50; page++) {
      const params = new URLSearchParams({limit: '1000', offset: String(offset), nsfw: 'true', sort: 'list_updated_at', fields: 'list_status,num_episodes,alternative_titles,media_type'});
      const result = await this.request(`/users/@me/animelist?${params}`);
      if (!Array.isArray(result.data)) throw new Error('MAL returned an invalid anime list. Your previous imported progress is unchanged.');
      for (const item of result.data) {
        const node = item.node, status = item.list_status;
        if (!Number.isInteger(node?.id) || node.id < 1 || typeof node.title !== 'string' || !Number.isInteger(status?.num_episodes_watched) || status.num_episodes_watched < 0) throw new Error('MAL returned an invalid progress entry. Your previous imported progress is unchanged.');
        entries.set(node.id, {id: node.id, title: node.title.slice(0, 180), alternative_titles: node.alternative_titles || {}, media_type: node.media_type || 'tv', num_episodes: node.num_episodes || 0, list_status: {status: status.status, num_episodes_watched: status.num_episodes_watched, is_rewatching: !!status.is_rewatching, updated_at: status.updated_at || null}});
      }
      if (!result.paging?.next) return [...entries.values()];
      const next = new URL(result.paging.next), base = new URL(API);
      const nextOffset = Number(next.searchParams.get('offset'));
      if (next.origin !== base.origin || next.pathname !== `${base.pathname}/users/@me/animelist` || !Number.isInteger(nextOffset) || nextOffset <= offset) throw new Error('MAL returned invalid list pagination. Your previous imported progress is unchanged.');
      offset = nextOffset;
    }
    throw new Error('MAL returned too many list pages. Your previous imported progress is unchanged.');
  }
  async update(id, plan) {
    return this.request(`/anime/${id}/my_list_status`, {method: 'PATCH', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(plan).toString()});
  }
}
