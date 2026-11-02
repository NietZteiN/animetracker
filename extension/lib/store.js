import {defaults} from './core.js';
export class Store {
  constructor(browserApi) { this.browser = browserApi; this.tail = Promise.resolve(); }
  run(work) {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => {});
    return result;
  }
  async load() {
    const {state} = await this.browser.storage.local.get('state');
    return {history: {}, mappings: {}, queue: {}, ...state, settings: {...defaults, ...state?.settings}};
  }
  save(state) { return this.browser.storage.local.set({state}); }
  async session(tabId) { return (await this.browser.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`] || {}; }
  saveSession(tabId, session) { return this.browser.storage.session.set({[`tab:${tabId}`]: session}); }
}
