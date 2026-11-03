# Anime Trail

A Chrome / Firefox / Zen WebExtension that keeps anime episode progress across websites and adds watched anime to MyAnimeList.

## Update 1.2.0 — Shared progress between PCs

Install Anime Trail in Firefox/Zen on each computer and connect the **same MyAnimeList account**. You can reuse your existing public MAL Client ID; authorize each browser separately. Your MAL list is imported automatically after connecting, when playback starts, and during background sync. Successful imports are cached for five minutes; **Refresh from MAL** in settings or **Sync now** forces a refresh.

For example: finish episode 7 on PC A and let it sync to MAL. On PC B, even with no local history, opening episode 1 produces **“MyAnimeList has you through episode 7; episode 8 is next.”** Continue follows a suitable episode link on the current website. If the site hides its episode links, the prompt tells you which episode to choose in its selector. Anime titles/seasons are matched against the imported MAL list; ambiguous matches still need selecting the correct MAL entry.

Settings now has a **MyAnimeList progress** library with shared episode counts, next episodes, and a last-refresh time. This browser’s detailed watch history remains separate. Local timestamps for the next unwatched episode are preserved; stale local episodes cannot override a higher MAL episode count. Unsynced progress further ahead on this PC is retained. Imports happen before planning outgoing updates and do not mark episodes watched locally or reduce MAL counts.

**MAL stores episode counts, not playback timestamps or streaming URLs.** Cross-PC continuation therefore starts at your next unwatched episode. An unfinished episode’s exact timestamp, custom site rules, manual title mappings, and watch-page links stay in the browser where they were recorded. Finishing/marking an episode watched on PC A must sync successfully before PC B can learn that progress. No additional cloud service or Firefox Sync account is required.

Imported lists are scoped to the connected MAL account. Disconnecting clears the imported cache while retaining local history; an account switch discards in-flight results from the old account. Failed imports retain the previous cache for offline use. Turning off automatic **writes** still permits reading your MAL progress; pausing tracking stops background progress refreshes too.

Load `dist/anime-trail-1.2.0.zip` over the existing temporary add-on without uninstalling, or Reload if you loaded `extension/manifest.json` directly. Reload watch pages after the update. History, login and the extension ID are preserved.

The fresh-PC browser test uses an empty disposable profile and a loopback MAL API fixture, without reading or modifying a real account:

```sh
python3 scripts/smoke.py /Applications/Twilight.app/Contents/MacOS/zen --cloud
```

## Update 1.1.0 — Continue where you left off

When playback starts on an episode that differs from your most recent saved progress for that anime/season, a small on-page prompt offers **Continue where you left off**. It shows the current episode and the saved episode/time. Opening the same episode at the beginning offers to resume its saved timestamp. The saved timestamp is preserved while the prompt is waiting for your choice.

- **Continue** prefers an unambiguous episode link already present on the current website. If one cannot be found, **Open saved episode** opens your saved watch page, which may be on a different website. The destination is shown in the prompt.
- After you choose Continue, the correct detected episode resumes at its saved time, including when playback is in a cross-origin iframe. It only seeks after that episode is detected; it never relabels the current video as another episode.
- **Stay on episode…**, **Start here**, the close button, or Escape while focused in the prompt dismisses it for that visit. It does not pause or seek without your choice. Reloading the page or changing episodes starts a new visit.
- If you finished the most recent episode, the prompt suggests the next episode. If the current site exposes no suitable next-episode link, it offers your last watch page and asks you to use that site’s episode selector. Known completed MAL entries do not suggest an episode beyond their total.
- Matches use normalized title and season, or a shared MAL entry plus your episode offsets for linked aliases. The prompt combines local history with the imported MAL list.
- Turn it off with **Settings → Tracking preferences → Offer to continue where I left off**.

Load `dist/anime-trail-1.1.0.zip` over your existing temporary add-on through `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…**, or click **Reload** if you loaded `extension/manifest.json` directly. Keep the existing add-on installed to preserve history and MAL login. Reload open watch pages after updating. The extension ID and permissions are unchanged.

Episode navigation is best effort: hidden episode menus and opaque links may require using the saved page or selecting the episode manually. A player that blocks seeking may require using its timeline. Resume times come from this browser’s local watch history; MAL stores episode counts rather than playback timestamps. Fullscreen video/iframe overlays can require leaving fullscreen to interact with the prompt.

## Update 1.0.1 — MAL connection fix

Fixed a Firefox-specific bug in the MAL client: assigning native `fetch` to the client and invoking it as a method gave it the wrong receiver. Firefox rejected it with `TypeError: 'fetch' called on an object that does not implement interface Window.` before making a network request. The client now uses a wrapper that invokes native fetch as a global function. The old generic “MyAnimeList could not be reached” message concealed this cause.

The update also declares explicit MAL host permissions, checks host access before opening OAuth, distinguishes request failures from timeouts/HTTP errors, and adds **Test connection** in settings. No new credentials or remote services are introduced.

For a temporary installation, open `about:debugging#/runtime/this-firefox` and use **Load Temporary Add-on…** to load `dist/anime-trail-1.0.1.zip` over the existing copy. The extension ID is unchanged, which preserves its browser storage. Do **not** remove/uninstall the existing add-on first. If you originally loaded `extension/manifest.json` directly, just click **Reload** for Anime Trail. Then reopen settings and connect MAL again. A failed earlier login will require fresh authorization.

The isolated browser test can verify storage survives an upgrade and test real connectivity with intentionally invalid credentials (no account is modified):

```sh
python3 scripts/smoke.py /Applications/Twilight.app/Contents/MacOS/zen --network --upgrade
```

## Chrome installation

1. Run `npm ci` and `npm run build` (Node.js 22.22.2+; Python is not needed for builds).
2. In **Chrome 120+**, open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select the generated **`dist/chrome/` folder**. Keep this folder in the same location when updating.
4. Open Anime Trail settings and follow the MAL setup below. Copy the **Chrome redirect URL shown in settings** into your MAL API client. Chrome and Firefox use different redirect URLs; configure an appropriate MAL client for each browser. Do not reuse a Firefox redirect URL in Chrome.
5. Reload open watch pages and pin the extension for quick access.

For updates, rebuild into the same folder and click **Reload** on the extension card, then reload watch pages. This preserves the unpacked extension ID and local history. Loading a different folder or uninstalling can change the ID or remove storage; recheck the redirect URL if the ID changes.

The Chrome archive is `dist/anime-trail-1.2.0-chrome.zip`; extract it before using Load unpacked. The Firefox manifest in `extension/` is not a Chrome package. Store publication is separate from this development installation and requires the maintainer's developer account.

## Firefox / Zen installation and MAL setup

1. In **Firefox or Zen 142+**, open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on…**, then select [`extension/manifest.json`](extension/manifest.json) or the ZIP in `dist/`.
3. Open Anime Trail’s settings from its toolbar popup. Settings also open on first installation.
4. Open [MyAnimeList’s API configuration](https://myanimelist.net/apiconfig) and create a client with **App Type: other**. The extension uses a public client with PKCE; no client secret is needed. Copy the **exact redirect URL shown in extension settings** into MAL’s App Redirect URL field. Keep the extension ID in the manifest unchanged so this URL remains stable.
5. Paste your Client ID into settings and click **Connect MyAnimeList**. Complete login and authorization on MAL.
6. Reload any watch pages that were open before installation, then play an episode. Pin the extension to your browser toolbar for quick access.

Temporary add-ons are removed when the browser closes. For persistent installation on regular Firefox/Zen builds, submit the contents of `extension/` to [Mozilla Add-on Developer Hub](https://addons.mozilla.org/developers/) for signing, selecting **On your own** for unlisted distribution. Install the signed `.xpi` using **about:addons → gear → Install Add-on From File…**. The included ZIP is a development archive, not a signed release. Signing/publishing requires your Mozilla account and is not done by this project.

## What it does

- Reads JSON-LD episode metadata, headings, Open Graph titles, page titles, episode indicators, and URL hints. Detects formats such as `S02E05`, `2x05`, `Season 2 Episode 5`, and `2nd Season Ep. 5`.
- Watches HTML video playback in the page, cross-origin embedded frames, and accessible open shadow roots.
- Keeps title, season (when exposed), episode, watch-page link, last playback position, and unique watched portions in this browser’s local extension storage. The same normalized title/season/episode shares progress across websites.
- Automatically links an exact, unambiguous MAL title/season match. English, Japanese, and synonym titles from MAL participate in matching. Fuzzy matches and uncertain seasons need a selection in the popup.
- Adds linked shows to your MAL list as **Watching**, without prematurely counting the current episode. Once an episode is watched, updates the count, and marks known finales **Completed**. Existing completed status and higher episode counts are preserved; scores and unrelated list fields are never changed.
- Counts an episode watched after **80% unique coverage plus 120 seconds of playback**, configurable in settings. Skipping ahead does not count the skipped portion. Replaying a portion does not increase unique coverage. You can also mark an episode watched manually.
- Retries failed MAL updates with backoff. Local progress persists without a network connection or MAL login. Background sync runs about once a minute and processes a bounded batch; large backlogs take multiple runs.
- Imports the complete, paginated MAL anime list and uses shared counts to offer your next episode on another PC. Imported progress is cached separately from local timestamps and history.
- Provides tracking pause, automatic-sync toggle, excluded hostnames, JSON history export, and custom CSS selector rules.

## Correcting a detection or MAL match

On the watch page, open the popup and select **Set title / episode**. Enter the anime’s title, episode, and optional season. The correction applies to that watch page; a new page or detected episode resets it. Corrections are useful on opaque player URLs or sites that hide episode metadata.

Use **Find / change match** to search MAL, choose the correct season, or paste a MAL anime ID / `https://myanimelist.net/anime/...` link. Matching uses the title and season, so the selection follows that title across sites. For English/Japanese aliases that produce different local titles, link both aliases to the same MAL ID. MAL’s episode count remains the common progress record.

Set an **episode offset** if the site uses continuous episode numbering across seasons. The calculation is `MAL episode = site episode + offset`: site episode 25 → MAL episode 1 uses **−24**. MAL seasons and split cours are separate entries; use a distinct corrected season/title when you need a separate mapping. Out-of-range episodes are held with an error instead of being written to MAL.

History’s **Open page** link opens the saved watch page. The on-page resume prompt offers a saved timestamp once playback starts; seeking happens only after you choose Continue. Removing a local history item never deletes anything from MAL.

## Coverage and limits

If a manual correction saves but the timestamp stays on **Waiting for playback**, check the player status at the top of the popup. It distinguishes a missing page connection, missing settings, sampling failure, no visible video, paused playback, and a video whose duration is not ready. After updating an unpacked extension, click **Reload** on its card in `chrome://extensions`, then fully reload the watch page before testing. The popup also offers **Reload watch page** when it cannot connect. A working login or toolbar icon alone does not establish that the page script is running.

There is no browser-only way to guarantee identification on every website. If a page exposes only an opaque identifier, uses an inaccessible player, or supplies no anime/episode metadata, use the manual correction. This extension does not recognize anime from video imagery or audio, bypass DRM, or use a remote recognition service.

Firefox system pages and restricted domains cannot run content scripts. Private windows are excluded. Live streams, clips shorter than a minute, fractional episode numbers, and inaccessible closed-shadow players are not automatically tracked. Separate frames choose the longest active video as the likely episode; unusual ad/player arrangements may need a correction. A buffered player must actually advance its media clock for coverage to accumulate. Browser suspension or long throttled timer gaps do not count toward watched coverage. Episode numbering alone cannot establish the right MAL season.

Locally stored titles are candidates until MAL matching succeeds; a non-anime video with episode-style metadata can appear in local history. Exclude websites you do not want tracked. Automatic matching deliberately accepts only exact, unambiguous anime results, but review a match if a site reports misleading metadata.

## Optional site rules

Settings → **Custom site rules** accepts an array:

```json
[
  {
    "hostname": "stream.example",
    "titleSelector": "h1.series-title",
    "episodeSelector": ".episode.active",
    "seasonSelector": ".current-season"
  }
]
```

Selectors read text, or `content` for metadata elements. Episode and season selectors may return bare positive integers or labeled text. Rules match the exact frame hostname and run alongside generic detection. Invalid selectors are rejected. No remote or user-supplied JavaScript runs.

## Privacy

See [PRIVACY.md](PRIVACY.md). There are no runtime npm dependencies, analytics, proxies, third-party metadata services, or remote scripts. MAL OAuth tokens stay in local extension storage and are excluded from exports. Disconnect deletes the tokens; removing the extension deletes its browser storage. Local storage is not an encrypted credential vault, and is only as private as your browser profile. The extension never asks for your MAL password.

## Development

Requires Node.js 22.22.2+ (or 24.15.0+). Python 3.10+ is only needed for the Firefox smoke test:

```sh
npm ci
npm test
npm run lint
npm run build
npm start
```

`npm start` defaults to the Zen executable on macOS. To use Firefox instead:

```sh
npx web-ext run --source-dir extension --firefox /path/to/firefox
```

The build writes unpacked folders in `dist/firefox/` and `dist/chrome/`, plus a reproducible ZIP and SHA-256 checksum for each browser. The original Firefox ZIP name is preserved. `scripts/package.py` remains a compatibility wrapper for the Node build. Archives contain only extension files, with a browser-specific manifest at the root. Test tools and `node_modules/` are never shipped. `web-ext` currently pulls upstream development-only audit advisories; this code has no production npm dependencies.

### Automatic release downloads

After this workflow is merged, maintainers can publish a GitHub release from a commit containing it. Set the same version in `package.json`, `package-lock.json`, and `extension/manifest.json`, then publish a release tagged `v1.2.0` (or `1.2.0`, replacing the version as appropriate). Publishing a release, including a prerelease, runs the tests, lint, and Chromium smoke test before attaching these files to its **Assets**:

- `anime-trail-1.2.0-chrome.zip` — Chrome extension, ready to extract and load.
- `anime-trail-1.2.0.zip` — Firefox/Zen development extension.
- A `.sha256` checksum file for each ZIP.

Downloads appear when the **Package release downloads** workflow finishes successfully. Draft releases and ordinary branch pushes do not publish downloads. A mismatched release tag fails before packaging; fix the version/tag and publish the correct release. Failed runs can be rerun from Actions; reruns replace assets with the same filenames. The workflow uses GitHub's built-in token and needs no additional secrets.

Chrome users can open the repository's **Releases**, download the ZIP ending in `-chrome.zip`, and extract it into a permanent folder. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder containing `manifest.json`. No Node installation or build commands are required. Firefox downloads still require Mozilla signing for persistent installation.

### Chrome browser smoke test

```sh
npx playwright install chromium
npm run smoke:chrome
```

On Linux CI, use `npx playwright install --with-deps chromium` first. This uses Playwright's Chromium in a disposable profile, not your installed Chrome profile. Generated loopback media verifies options, the Chrome OAuth redirect, real cross-origin iframe playback, saved history, the resume prompt and iframe seeking, popup pause/resume, and persistence after a forced service-worker restart. It never connects to a real MAL account. MAL OAuth and API behavior are covered by mocked unit tests; real-account authorization still needs a manual check with your own client.

### Firefox browser smoke test

```sh
python3 scripts/smoke.py /Applications/Zen.app/Contents/MacOS/zen
# or provide the path to a Firefox executable
```

This starts an isolated temporary browser profile, installs the unsigned extension temporarily, and serves generated test media over loopback. It checks options, preferences, real cross-origin iframe playback, mismatched-episode prompts, navigation and timestamp resume, dismissal, history actions, and toolbar popup controls. With `--cloud`, a test-only copy of the extension points to a local mock MAL API and verifies automatic imports, episode continuation with empty local history, and protection against overwriting higher remote counts. The production ZIP is unchanged by this fixture. It writes screenshots and a browser log to `test-results/`. The user's existing profile is never opened. It does not contact MAL unless `--network` is specified, and never modifies a real account.

Automated tests exercise parsing, season resolution, watched coverage, seek rejection, storage serialization, offline queues, monotonic MAL updates, PKCE state/redirect validation, token refresh, and form-encoded API requests. MAL requests are mocked. A live end-to-end account sync requires a real API client and account authorization.

## Implementation and references

- `extension/content.js`: page scanning and video sampling.
- `extension/resume-ui.js`: isolated on-page resume card and episode-link discovery.
- `extension/lib/resume.js`: local resume selection across titles, seasons, and MAL aliases.
- `extension/lib/detection.js`: site-independent parser shared with tests.
- `extension/lib/core.js`: watched coverage, matching, and update planning.
- `extension/lib/controller.js`: session orchestration, local history, queue, and settings.
- `extension/lib/mal.js`: MAL authorization-code PKCE, refresh, search, and list updates.
- `extension/background.js`: event-page messaging and alarm scheduling.
- `extension/ui/`: popup, setup/settings, and history.

Uses Firefox Manifest V3 [event-page background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts) and [`identity.launchWebAuthFlow`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity/launchWebAuthFlow). API behavior follows the [official MAL OAuth reference](https://myanimelist.net/apiconfig/references/authorization) (currently `plain` PKCE) and [MAL API v2](https://myanimelist.net/apiconfig/references/api/v2) (`PATCH /anime/{id}/my_list_status`, `num_watched_episodes` in requests and `num_episodes_watched` in responses). [Firefox data transmission disclosures](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/) are declared in the manifest. Persistent releases require [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

Chrome uses a Manifest V3 [module service worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics), [callback-compatible async message replies](https://developer.chrome.com/docs/extensions/develop/concepts/messaging), and [PNG manifest icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons). Firefox keeps its existing event-page background and add-on ID. Both builds share the same tracking and MAL code.
