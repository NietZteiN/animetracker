// Loaded as a classic content script and as a side-effect module in extension pages.
(() => {
  const browser = globalThis.browser || globalThis.chrome;
  function onMessage(listener) {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      let response;
      try { response = listener(message, sender); }
      catch (error) { response = Promise.reject(error); }
      // Do not claim messages this listener does not handle.
      if (response === undefined) return false;
      Promise.resolve(response).then(sendResponse, error => sendResponse({ok: false, error: error.message || 'An unexpected error occurred.'}));
      // Chrome versions before 148 require the callback channel for async replies.
      return true;
    });
  }
  globalThis.AnimeTrailBrowser = {browser, onMessage};
})();
