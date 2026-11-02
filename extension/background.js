import {Store} from './lib/store.js';
import {MalClient} from './lib/mal.js';
import {Controller} from './lib/controller.js';
const store = new Store(browser), mal = new MalClient(browser), controller = new Controller(browser, store, mal);
const uiRoot = browser.runtime.getURL('ui/');
const sync = force => controller.sync(force);
browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message.type !== 'string') return undefined;
  const content = !!sender.tab && !sender.url?.startsWith(uiRoot);
  let task;
  if (content) {
    if (message.type === 'contentConfig') task = controller.config(sender);
    else if (message.type === 'observe') task = store.run(() => controller.observe(message, sender));
    else if (message.type === 'resumeAction') task = store.run(() => controller.resumeAction(message, sender));
    else return undefined;
  } else {
    if (!sender.url?.startsWith(uiRoot)) return undefined;
    const operations = {
      view: () => controller.view(message.tabId),
      settings: () => controller.settings(message.settings || {}),
      search: () => mal.search(message.query),
      link: () => controller.link(message),
      correct: () => controller.correct(message),
      complete: () => controller.complete(message.key),
      remove: () => controller.remove(message.key),
      export: async () => {
        const state = await store.load();
        return {version: 1, exportedAt: new Date().toISOString(), history: state.history, mappings: state.mappings};
      }
    };
    if (message.type === 'connect') task = store.load().then(s => mal.connect(s.settings.clientId));
    else if (message.type === 'disconnect') task = mal.disconnect();
    else if (message.type === 'testConnection') task = mal.testConnection();
    else if (message.type === 'sync') task = sync(true);
    else if (operations[message.type]) task = store.run(operations[message.type]);
    else return undefined;
  }
  return task.then(data => ({ok: true, data}), error => ({ok: false, error: error.message || 'An unexpected error occurred.'}));
});
browser.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'sync') sync(false).catch(console.error); });
browser.tabs.onRemoved.addListener(id => { browser.storage.session.remove(`tab:${id}`).catch(console.error); });
browser.runtime.onInstalled.addListener(async ({reason}) => {
  await browser.alarms.create('sync', {periodInMinutes: 1});
  if (reason === 'install') browser.runtime.openOptionsPage();
});
browser.runtime.onStartup.addListener(() => { browser.alarms.create('sync', {periodInMinutes: 1}); });
