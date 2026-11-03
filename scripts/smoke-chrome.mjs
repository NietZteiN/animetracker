/** Isolated Chromium smoke test; only generated loopback media, no MAL account. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const extension = fileURLToPath(new URL('../dist/chrome', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'anime-trail-chrome-'));
// A finite silent WAV plays in a video element without external codecs or fixtures.
const audio = Buffer.alloc(44 + 180 * 8000);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(8000, 28); audio.writeUInt16LE(1, 32);
audio.writeUInt16LE(8, 34); audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40); audio.fill(128, 44);
const servers = [];
async function serve(handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
let context;
try {
  const player = await serve((req, res) => {
    if (req.url === '/media.wav') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
      if (start > end || start >= audio.length) { res.writeHead(416, {'Content-Range': `bytes */${audio.length}`}); res.end(); return; }
      const headers = {'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1};
      if (range) headers['Content-Range'] = `bytes ${start}-${end}/${audio.length}`;
      res.writeHead(range ? 206 : 200, headers); res.end(audio.subarray(start, end + 1));
    }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<video controls src="/media.wav"></video>'); }
  });
  const site = await serve((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`${req.url.startsWith('/watch/') ? '<title>Netflix</title>' : '<title>Frieren Episode 3</title><h1>Frieren Episode 3</h1>'}<iframe src="${player}/player"></iframe>`); });
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--autoplay-policy=no-user-gesture-required']
  });
  context.setDefaultTimeout(10000);
  const errors = [];
  context.on('weberror', error => errors.push(error.error().message));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/ui/options.html`);
  await options.locator('#redirect').filter({hasText: '.chromiumapp.org/'}).waitFor();
  assert.equal(await options.locator('#enabled').isChecked(), true);
  console.log('PASS: service worker, options, Chrome OAuth redirect and async RPC');
  const watch = await context.newPage();
  await watch.goto(`${site}/frieren-episode-3`);
  const frame = watch.frameLocator('iframe');
  await frame.locator('video').evaluate(video => video.play());
  await options.waitForFunction(async () => {
    const {state} = await chrome.storage.local.get('state');
    return Object.values(state?.history || {}).some(item => item.title === 'Frieren' && item.episode === 3 && item.position > 0);
  });
  console.log('PASS: episode detection and real cross-origin iframe playback saved to history');
  // Seed a meaningful timestamp in the disposable profile to exercise resume/seek.
  await frame.locator('video').evaluate(video => video.pause());
  await options.evaluate(async () => {
    const {state} = await chrome.storage.local.get('state');
    for (const record of Object.values(state.history)) Object.assign(record, {position: 70, playedSeconds: 30, ranges: [[40, 70]]});
    await chrome.storage.local.set({state});
  });
  await watch.reload();
  await frame.locator('video').evaluate(video => video.play());
  const resume = watch.getByRole('button', {name: 'Resume at 1:10', exact: true});
  await resume.click();
  await resume.waitFor({state: 'hidden'});
  await frame.locator('video').evaluate(video => {
    if (Math.abs(video.currentTime - 70) > 5) throw new Error(`Resume failed: ${video.currentTime}`);
  });
  console.log('PASS: on-page resume prompt and asynchronous iframe seek response');
  const tabId = await options.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, watch.url());
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/ui/popup.html`);
  // An extension popup opened as a tab has no watch-tab context; verify its controls via RPC.
  await popup.locator('#tracking-label').filter({hasText: 'Tracking'}).waitFor();
  const view = await popup.evaluate(async tabId => chrome.runtime.sendMessage({type: 'view', tabId}), tabId);
  assert.equal(view.data.current.episode, 3);
  await popup.locator('#pause').click();
  await popup.locator('#tracking-label').filter({hasText: 'Paused'}).waitFor();
  await popup.locator('#pause').click();
  await popup.locator('#tracking-label').filter({hasText: 'Tracking'}).waitFor();
  console.log('PASS: popup, saved current episode and pause/resume controls');
  // Force a worker restart, then ensure persisted history and session state still work.
  const cdp = await context.newCDPSession(options);
  const versions = [];
  cdp.on('ServiceWorker.workerVersionUpdated', event => versions.push(...event.versions));
  await cdp.send('ServiceWorker.enable');
  await options.waitForFunction(() => true); // Yield until queued protocol events have arrived.
  const version = versions.find(value => value.scriptURL === worker.url() && value.status === 'activated');
  assert.ok(version, 'Expected an activated extension service worker');
  await cdp.send('ServiceWorker.stopWorker', {versionId: version.versionId});
  const restored = await options.evaluate(async tabId => chrome.runtime.sendMessage({type: 'view', tabId}), tabId);
  assert.equal(restored.ok, true);
  assert.equal(restored.data.current.episode, 3);
  assert.ok(restored.data.history.length > 0);
  assert.deepEqual(errors, []);
  console.log('PASS: worker restart retains history/session and responds to new messages; no page errors');
  const opaque = await context.newPage();
  await opaque.goto(`${site}/watch/12345`);
  const opaqueTab = await options.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, opaque.url());
  await opaque.frameLocator('iframe').locator('video').evaluate(video => video.play());
  const status = await options.evaluate(async tabId => chrome.runtime.sendMessage({type: 'view', tabId}), opaqueTab);
  assert.equal(status.data.current, null);
  assert.equal(status.data.playback.connected, true);
  assert.equal(status.data.playback.configured, true);
  const correction = await options.evaluate(async tabId => chrome.runtime.sendMessage({type: 'correct', tabId,
    candidate: {title: 'Opaque player test', episode: 7, season: 1}}), opaqueTab);
  assert.equal(correction.ok, true);
  await options.waitForFunction(async () => {
    const {state} = await chrome.storage.local.get('state');
    return Object.values(state.history).some(record => record.title === 'Opaque player test' && record.position > 1);
  });
  const initial = await options.evaluate(async () => Object.values((await chrome.storage.local.get('state')).state.history).find(record => record.title === 'Opaque player test').position);
  await options.waitForFunction(async initial => {
    const {state} = await chrome.storage.local.get('state');
    return Object.values(state.history).some(record => record.title === 'Opaque player test' && record.position > initial + 1);
  }, initial);
  assert.deepEqual(errors, []);
  console.log('PASS: opaque watch URL with no episode metadata tracks advancing iframe playback after manual correction');
} catch (error) {
  for (const page of context?.pages() || []) {
    if (page.url().startsWith('http://127.0.0.1:')) console.error('Watch-page diagnostics:', await page.locator('[role="status"]').allTextContents());
  }
  throw error;
} finally {
  await context?.close();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  await rm(profile, {recursive: true, force: true});
}
