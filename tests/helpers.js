import {Store} from '../extension/lib/store.js';
import {Controller} from '../extension/lib/controller.js';
export function memoryBrowser() {
  const area = () => {
    const data = {};
    return {
      data,
      async get(key) { return structuredClone(key == null ? data : {[key]: data[key]}); },
      async set(next) { Object.assign(data, structuredClone(next)); },
      async remove(key) { delete data[key]; }
    };
  };
  const tab = {id: 7, url: 'https://watch.example/watch/frieren-episode-3', incognito: false};
  const messages = [];
  return {storage: {local: area(), session: area()}, tabs: {async get() { return tab; }, async sendMessage(id, message, options) { messages.push({id, message, options}); return {ok: true}; }, async update(id, update) { Object.assign(tab, update); return tab; }}, identity: {getRedirectURL: () => 'https://trail.extensions.allizom.org/'}, tab, messages};
}
export function setup(malOverrides = {}) {
  const browser = memoryBrowser(), store = new Store(browser);
  const updates = [];
  const mal = {
    auth: async () => ({user: {id: 1, name: 'tester'}}),
    search: async () => [{id: 52991, title: 'Frieren', num_episodes: 28, media_type: 'tv'}],
    watchList: async () => [],
    detail: async id => ({id, title: 'Frieren', num_episodes: 28, my_list_status: {status: 'watching', num_episodes_watched: 2}}),
    update: async (id, plan) => { updates.push({id, plan}); return {}; },
    disconnect: async () => {}, ...malOverrides
  };
  return {browser, store, mal, updates, controller: new Controller(browser, store, mal), sender: {tab: browser.tab, frameId: 0, url: browser.tab.url}};
}
export const candidate = {title: 'Frieren', season: 1, episode: 3, source: 'Test metadata'};
export const sample = position => ({mediaId: 'main-video', duration: 1200, position, rate: 1, playing: true, seeking: false});
