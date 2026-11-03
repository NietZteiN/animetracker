import test from 'node:test';
import assert from 'node:assert/strict';
import {MalClient} from '../extension/lib/mal.js';
import {memoryBrowser} from './helpers.js';
const response = (body, status = 200) => ({ok: status < 400, status, json: async () => body});
test('default native fetch is never called with the MalClient as its receiver', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async function () {
      if (this !== undefined && this !== globalThis) throw new TypeError("'fetch' called on an object that does not implement interface Window.");
      return response({connected: true});
    };
    const client = new MalClient(memoryBrowser());
    assert.deepEqual(await client.json('https://api.myanimelist.net/v2/users/@me'), {connected: true});
  } finally { globalThis.fetch = originalFetch; }
});
test('PKCE verifies state and callback, exchanges code without a secret, stores user and tokens', async () => {
  const browser = memoryBrowser(); const requests = [];
  browser.identity.launchWebAuthFlow = async ({url, interactive}) => {
    assert.equal(interactive, true);
    const params = new URL(url).searchParams;
    assert.equal(params.get('code_challenge_method'), 'plain'); assert.ok(params.get('code_challenge').length >= 43);
    return `${browser.identity.getRedirectURL()}?code=one-time&state=${params.get('state')}`;
  };
  const mal = new MalClient(browser, async (url, options) => {
    requests.push({url, options});
    return response(url.endsWith('/token') ? {access_token: 'access', refresh_token: 'refresh', expires_in: 3600} : {id: 1, name: 'Caden'});
  });
  assert.deepEqual(await mal.connect('example-client-id'), {id: 1, name: 'Caden'});
  const body = new URLSearchParams(requests[0].options.body);
  assert.equal(body.get('grant_type'), 'authorization_code'); assert.equal(body.has('client_secret'), false); assert.equal(body.get('code'), 'one-time');
  assert.equal((await mal.auth()).refreshToken, 'refresh');
  await mal.disconnect(); assert.equal(await mal.auth(), null);
});
test('rejects mismatched state, foreign callbacks and authorization denials', async () => {
  for (const redirect of ['https://trail.extensions.allizom.org/?state=wrong&code=x', 'https://evil.example/?state=x&code=x']) {
    const browser = memoryBrowser(); browser.identity.launchWebAuthFlow = async () => redirect;
    const mal = new MalClient(browser, () => { throw new Error('Must not call network'); });
    await assert.rejects(mal.connect('example-client-id'), /verified/); assert.equal(await mal.auth(), null);
  }
});
test('refresh rotates tokens and authenticated requests retry once after HTTP 401', async () => {
  const browser = memoryBrowser();
  await browser.storage.local.set({auth: {accessToken: 'old', refreshToken: 'refresh-old', expiresAt: Date.now() + 3600000, clientId: 'client'}});
  let calls = 0;
  const mal = new MalClient(browser, async (url, options) => {
    if (url.endsWith('/token')) {
      assert.equal(new URLSearchParams(options.body).get('refresh_token'), 'refresh-old');
      return response({access_token: 'new', refresh_token: 'refresh-new', expires_in: 3600});
    }
    calls++;
    return options.headers.Authorization === 'Bearer old' ? response({}, 401) : response({id: 1});
  });
  assert.deepEqual(await mal.detail(1), {id: 1}); assert.equal(calls, 2); assert.equal((await mal.auth()).refreshToken, 'refresh-new');
});
test('PATCH uses the official update parameter name and form encoding', async () => {
  const browser = memoryBrowser();
  await browser.storage.local.set({auth: {accessToken: 'token', expiresAt: Date.now() + 3600000}});
  const mal = new MalClient(browser, async (url, options) => {
    assert.equal(options.method, 'PATCH'); assert.equal(url, 'https://api.myanimelist.net/v2/anime/1/my_list_status');
    assert.equal(options.body, 'status=watching&num_watched_episodes=3'); assert.equal(options.credentials, 'omit');
    return response({status: 'watching', num_episodes_watched: 3});
  });
  await mal.update(1, {status: 'watching', num_watched_episodes: 3});
});
test('never echoes sensitive API error payloads', async () => {
  const mal = new MalClient(memoryBrowser(), async () => response({error: 'sensitive-secret-value'}, 400));
  await assert.rejects(mal.json('https://myanimelist.net/v1/oauth2/token'), error => !error.message.includes('sensitive-secret-value'));
});
test('concurrent requests share one token refresh', async () => {
  const browser = memoryBrowser();
  await browser.storage.local.set({auth: {accessToken: 'expired', refreshToken: 'old', expiresAt: 0, clientId: 'client'}});
  let refreshes = 0;
  const mal = new MalClient(browser, async url => {
    if (url.endsWith('/token')) { refreshes++; await new Promise(resolve => setTimeout(resolve, 5)); return response({access_token: 'new', refresh_token: 'next', expires_in: 3600}); }
    return response({id: 1});
  });
  await Promise.all([mal.detail(1), mal.detail(2), mal.detail(3)]);
  assert.equal(refreshes, 1);
});
test('reports missing host permissions before opening OAuth or sending requests', async () => {
  const browser = memoryBrowser(); browser.permissions = {contains: async () => false};
  let opened = false; browser.identity.launchWebAuthFlow = async () => { opened = true; };
  const mal = new MalClient(browser, () => { throw new Error('Network must not be called'); });
  await assert.rejects(mal.connect('example-client-id'), error => error.code === 'MAL_HOST_PERMISSION' && error.message.includes('extension settings'));
  assert.equal(opened, false);
});
test('distinguishes token timeouts from network and browser blocking without exposing secrets', async () => {
  for (const [name, code] of [['TimeoutError', 'MAL_TIMEOUT'], ['TypeError', 'MAL_NETWORK'], ['SecurityError', 'MAL_BROWSER_BLOCKED']]) {
    const mal = new MalClient(memoryBrowser(), async () => { const error = new Error('secret-token-and-code'); error.name = name; throw error; });
    await assert.rejects(mal.token({}), error => error.code === code && error.message.includes('MAL token endpoint') && !error.message.includes('secret-token-and-code'));
  }
});
test('makes client rejection actionable and distinguishes HTML challenge responses', async () => {
  const invalidClient = new MalClient(memoryBrowser(), async () => response({error: 'secret-provider-payload'}, 401));
  await assert.rejects(invalidClient.token({}), error => error.status === 401 && error.message.includes('app type is other') && !error.message.includes('secret-provider-payload'));
  const challenge = new MalClient(memoryBrowser(), async () => ({status: 403, ok: false, json: async () => { throw new SyntaxError('secret-html'); }}));
  await assert.rejects(challenge.token({}), error => error.status === 403 && error.message.includes('verification page') && !error.message.includes('secret-html'));
});
test('connection test treats unauthenticated HTTP responses as reachable, not authenticated', async () => {
  const seen = [];
  const mal = new MalClient(memoryBrowser(), async (url, options) => { seen.push(options); return response({}, url.includes('/token') ? 405 : 403); });
  const results = await mal.testConnection();
  assert.equal(results.length, 2); assert.equal(results.every(r => r.reachable), true);
  assert.equal(results.some(r => r.authenticated === true), false);
  assert.equal(seen.every(o => o.method === 'GET' && !o.body && o.credentials === 'omit' && o.referrerPolicy === 'no-referrer'), true);
});
test('connection test identifies the failing server while preserving saved auth', async () => {
  const browser = memoryBrowser(); const auth = {accessToken: 'private-access-token', refreshToken: 'private-refresh-token'};
  await browser.storage.local.set({auth});
  const mal = new MalClient(browser, async (url, options) => {
    if (url.includes('/token')) throw new TypeError('private-response');
    assert.equal(options.headers.Authorization, 'Bearer private-access-token');
    return response({}, 200);
  });
  const result = await mal.testConnection();
  assert.equal(result[0].reachable, false); assert.equal(result[1].authenticated, true);
  assert.deepEqual(await mal.auth(), auth); assert.equal(JSON.stringify(result).includes('private-'), false);
});
