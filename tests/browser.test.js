import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../extension/lib/browser.js', import.meta.url), 'utf8');
for (const namespace of ['browser', 'chrome']) {
  test(`${namespace}: async messaging keeps the callback channel open and returns data/errors`, async () => {
    let receive;
    const api = {runtime: {onMessage: {addListener(listener) { receive = listener; }}}};
    const context = vm.createContext({[namespace]: api});
    vm.runInContext(script, context);
    assert.equal(context.AnimeTrailBrowser.browser, api);
    context.AnimeTrailBrowser.onMessage(message => {
      if (message.type === 'ok') return Promise.resolve({ok: true, data: 42});
      if (message.type === 'reject') return Promise.reject(new Error('Failed'));
      if (message.type === 'throw') throw new Error('Failed');
    });
    for (const type of ['ok', 'reject', 'throw']) {
      const response = await new Promise(resolve => assert.equal(receive({type}, {}, resolve), true));
      assert.equal(response.ok, type === 'ok');
      if (response.ok) assert.equal(response.data, 42);
      else assert.equal(response.error, 'Failed');
    }
    assert.equal(receive({type: 'unrelated'}, {}, () => assert.fail('Unexpected response')), false);
  });
}

test('Firefox browser namespace wins when both extension namespaces exist', () => {
  const browser = {}, context = vm.createContext({browser, chrome: {}});
  vm.runInContext(script, context);
  assert.equal(context.AnimeTrailBrowser.browser, browser);
});
