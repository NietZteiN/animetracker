# Anime Trail privacy

Anime Trail keeps detected episode candidates, corrected titles, seasons, episode numbers, page URLs, last playback positions, watched time ranges, MAL mappings, settings, pending updates, and MAL login tokens in this browser’s extension storage. Tab/frame sessions are kept in session storage. Private-window playback is not recorded.

When you connect MyAnimeList, the extension communicates directly with `myanimelist.net` for login and token refresh and `api.myanimelist.net` for anime title searches, anime details, your MAL username/ID, and updates to list status and episode counts. MyAnimeList receives the title search queries, requested anime IDs, authentication credentials issued by its OAuth flow, and submitted watch status/counts. This communication is governed by [MyAnimeList’s privacy policy](https://myanimelist.net/about/privacy_policy).

Page URLs, video files, audio, screenshots, and full page contents are not uploaded. There is no analytics service, external backend, or other metadata provider. No passwords, cookies, or browsing-history API data are read. The all-websites permission lets the extension read title/episode metadata and media playback in watch pages and embedded frames.

The optional **Test connection** button makes read-only requests to the MAL login server and anime API. If you are connected, the API check uses your saved access token to test whether login is accepted. The results show reachability and HTTP status only; they do not contain tokens or account details. The check does not change your MAL list or settings.

The **Continue where you left off** prompt uses local history for the detected anime/season and displays its saved episode and timestamp on the current watch page. Only the related resume suggestion is sent to the top page’s extension content script, and player seek commands target the owning frame. It performs no extra MAL or third-party lookup. Choosing Continue can navigate to an episode link on the current site or the saved watch page (whose hostname is displayed), and seek once the matching episode starts. Pending resume instructions expire after five minutes. The prompt can be disabled in tracking preferences.

Tracking can be paused globally; individual hostnames and their subdomains can be excluded. Automatic MAL syncing can be disabled independently. Sync now explicitly processes pending updates while tracking is enabled. Disconnecting deletes stored MAL tokens and stops authenticated calls. Previously synced MAL list entries remain on MAL. Local history can be removed per episode. Uninstalling deletes local extension data through the browser.

Exports contain history and MAL mappings, including watch-page URLs, and exclude login tokens and client settings. Keep exports private. Extension storage is local to your browser profile and is not encrypted by Anime Trail. Use your browser and operating system’s usual profile protection.
