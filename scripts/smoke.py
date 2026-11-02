"""Run a real Firefox/Zen smoke test in a disposable profile. No third-party Python packages.

Usage: python3 scripts/smoke.py [path/to/firefox-or-zen]
Only a loopback automation port is used. The user's browser profile is never opened.
"""
import base64
import contextlib
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "test-results"
RESULTS.mkdir(exist_ok=True)
NETWORK = "--network" in sys.argv
UPGRADE = "--upgrade" in sys.argv
POSITIONAL = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
BINARY = POSITIONAL[0] if POSITIONAL else "/Applications/Zen.app/Contents/MacOS/zen"


class Marionette:
    def __init__(self, port):
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=20)
        self.seq = 0
        self.read()

    def read(self):
        size = b""
        while True:
            byte = self.sock.recv(1)
            if not byte:
                raise EOFError("Browser connection closed")
            if byte == b":":
                break
            size += byte
        payload = b""
        while len(payload) < int(size):
            payload += self.sock.recv(int(size) - len(payload))
        return json.loads(payload)

    def command(self, name, params=None):
        self.seq += 1
        payload = json.dumps([0, self.seq, name, params or {}]).encode()
        self.sock.sendall(str(len(payload)).encode() + b":" + payload)
        result = self.read()
        if result[2]:
            raise RuntimeError(f"{name}: {result[2]}")
        value = result[3]
        return value.get("value") if isinstance(value, dict) and "value" in value else value

    def script(self, source, asynchronous=False, args=None):
        return self.command("WebDriver:ExecuteAsyncScript" if asynchronous else "WebDriver:ExecuteScript", {"script": source, "args": args or [], "newSandbox": False, "sandbox": None, "line": 1, "filename": "smoke.py"})

    def wait(self, expression, timeout=15):
        until = time.monotonic() + timeout
        while time.monotonic() < until:
            result = self.script(f"return ({expression});")
            if result:
                return result
            time.sleep(0.2)
        raise AssertionError(f"Timed out: {expression}")

    def navigate(self, url):
        self.command("WebDriver:Navigate", {"url": url})

    def rpc(self, kind, **payload):
        message = {"type": kind, **payload}
        result = self.script("const done=arguments[arguments.length-1]; browser.runtime.sendMessage(arguments[0]).then(done, e=>done({error:e.message}));", True, [message])
        assert result.get("ok"), result
        return result.get("data")

    def screenshot(self, name):
        encoded = self.command("WebDriver:TakeScreenshot", {"id": None, "full": False, "hash": False})
        (RESULTS / name).write_bytes(base64.b64decode(encoded))


class Fixture(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        # A generated PCM audio file is served through a video element to exercise
        # actual media timeupdates without a downloaded or copyrighted fixture.
        if self.path == "/episode.wav":
            import io
            import wave
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(8000)
                audio.writeframes(b"\0\0" * 8000 * 180)
            data = buffer.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
        else:
            if self.path == "/player":
                html = '<title>Embedded Player</title><video controls autoplay muted src="/episode.wav"></video>'
            else:
                episode = int(parse_qs(urlparse(self.path).query).get('episode', ['3'])[0])
                html = f'<title>Frieren S01E{episode:02d} | Test Stream</title><style>body{{background:#111820;color:#eee;font:18px sans-serif;padding:40px}}iframe{{display:block;width:85%;height:400px;border:1px solid #35404e;margin:30px 0}}a{{color:#b6f07b;margin-right:25px}}</style><h1>Frieren</h1><iframe src="http://localhost:{self.server.server_port}/player"></iframe><nav class="episodes"><a href="/watch?episode=1">Episode 1</a><a href="/watch?episode=3">Episode 3</a><a href="/watch?episode=5">Episode 5</a></nav>'
            data = html.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        with contextlib.suppress(BrokenPipeError, ConnectionResetError):
            self.wfile.write(data)


def main():
    subprocess.run([sys.executable, str(ROOT / "scripts/package.py")], check=True)
    manifest = json.loads((ROOT / "extension/manifest.json").read_text())
    archive = ROOT / f'dist/anime-trail-{manifest["version"]}.zip'
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="anime-trail-smoke-") as profile:
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            port = reservation.getsockname()[1]
        prefs = {"marionette.port": port, "devtools.console.stdout.content": True, "devtools.console.stdout.chrome": True, "browser.shell.checkDefaultBrowser": False, "browser.startup.homepage_override.mstone": "ignore", "browser.aboutwelcome.enabled": False, "zen.welcome-screen.seen": True, "media.autoplay.default": 0, "extensions.autoDisableScopes": 0, "datareporting.policy.dataSubmissionPolicyBypassNotification": True}
        Path(profile, "user.js").write_text("\n".join(f'user_pref({json.dumps(k)}, {json.dumps(v)});' for k, v in prefs.items()))
        log = (RESULTS / "zen-smoke.log").open("w")
        env = {**os.environ, "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1", "MOZ_HEADLESS": "1"}
        process = subprocess.Popen([BINARY, "--headless", "--no-remote", "--marionette", "--remote-allow-system-access", "--profile", profile], env=env, stdout=log, stderr=log)
        try:
            until = time.monotonic() + 30
            while True:
                try:
                    mn = Marionette(port)
                    break
                except OSError:
                    if process.poll() is not None or time.monotonic() > until:
                        raise RuntimeError("Browser did not start. See test-results/zen-smoke.log")
                    time.sleep(0.3)
            session = mn.command("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"acceptInsecureCerts": True}}})
            print("Browser session:", session.get("capabilities", {}).get("browserVersion"), flush=True)
            previous = ROOT / 'dist/anime-trail-1.0.0.zip'
            if UPGRADE:
                assert previous.exists(), 'The 1.0.0 archive is needed for the upgrade test.'
            mn.command("Addon:Install", {"path": str(previous if UPGRADE else archive), "temporary": True})
            mn.command("Marionette:SetContext", {"value": "chrome"})
            uuid = mn.script("return JSON.parse(Services.prefs.getStringPref('extensions.webextensions.uuids'))[arguments[0]];", args=[manifest["browser_specific_settings"]["gecko"]["id"]])
            mn.command("Marionette:SetContext", {"value": "content"})
            origin = f"moz-extension://{uuid}"
            mn.navigate(origin + "/ui/options.html")
            mn.wait("document.getElementById('redirect')?.textContent.startsWith('https://')")
            # Zen's first-run automation context can be an untabbed browser.
            # Create a normal WebExtension tab before testing content senders.
            handles = set(mn.command('WebDriver:GetWindowHandles'))
            mn.script("const done=arguments[arguments.length-1];browser.tabs.create({url:arguments[0]}).then(t=>done(t.id));", True, [origin + '/ui/options.html'])
            new_handles = set(mn.command('WebDriver:GetWindowHandles')) - handles
            assert len(new_handles) == 1, new_handles
            mn.command('WebDriver:SwitchToWindow', {'handle': new_handles.pop()})
            mn.wait("document.getElementById('redirect')?.textContent.startsWith('https://')")
            assert mn.rpc("view")["settings"]["threshold"] == 80
            if UPGRADE:
                mn.rpc('settings', settings={'threshold': 79})
                mn.command('Addon:Install', {'path': str(archive), 'temporary': True})
                # Firefox closes old extension pages while replacing the add-on.
                surviving = mn.command('WebDriver:GetWindowHandles')
                assert surviving, 'No browser window survived the extension upgrade'
                mn.command('WebDriver:SwitchToWindow', {'handle': surviving[0]})
                mn.navigate(origin + '/ui/options.html')
                mn.wait("document.getElementById('redirect')?.textContent.startsWith('https://')")
                handles = set(mn.command('WebDriver:GetWindowHandles'))
                mn.script("const done=arguments[arguments.length-1];browser.tabs.create({url:arguments[0]}).then(t=>done(t.id));", True, [origin + '/ui/options.html'])
                normal = set(mn.command('WebDriver:GetWindowHandles')) - handles
                assert len(normal) == 1, normal
                mn.command('WebDriver:SwitchToWindow', {'handle': normal.pop()})
                mn.wait("document.getElementById('redirect')?.textContent.startsWith('https://')")
                assert mn.rpc('view')['settings']['threshold'] == 79
                mn.rpc('settings', settings={'threshold': 80})
                print(f'PASS: loading {manifest["version"]} over 1.0.0 retains extension storage', flush=True)
            if NETWORK:
                # Public connectivity probes only: no saved credentials or real account writes.
                probes = mn.script("""
                    const done=arguments[arguments.length-1];
                    Promise.all([
                      ['api','https://api.myanimelist.net/v2/users/@me',{}],
                      ['api-with-auth-header','https://api.myanimelist.net/v2/users/@me',{headers:{Authorization:'Bearer invalid-connectivity-probe'}}],
                      ['token','https://myanimelist.net/v1/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=authorization_code&client_id=00000000000000000000000000000000&code=invalid-connectivity-probe&code_verifier=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}]
                    ].map(async ([name,url,options]) => {
                      try { const response=await fetch(url,{...options,credentials:'omit',signal:AbortSignal.timeout(12000)}); return {name,status:response.status,contentType:response.headers.get('content-type')}; }
                      catch(error) { return {name,error:error.name,message:error.message}; }
                    })).then(done);
                """, True)
                print('Live MAL connectivity:', json.dumps(probes), flush=True)
                print('MAL host permissions:', mn.script("const done=arguments[arguments.length-1];browser.permissions.contains({origins:['https://myanimelist.net/*','https://api.myanimelist.net/*']}).then(done);", True), flush=True)
                assert all('status' in probe for probe in probes), probes
                receiver = mn.script("const done=arguments[arguments.length-1];const holder={fetcher:fetch};holder.fetcher('https://api.myanimelist.net/v2/users/@me',{credentials:'omit',signal:AbortSignal.timeout(10000)}).then(r=>done({status:r.status}),e=>done({name:e.name,message:e.message}));", True)
                assert receiver.get('name') == 'TypeError' and 'interface Window' in receiver.get('message', ''), receiver
                print('PASS: original unbound-fetch receiver failure reproduced', flush=True)
                mn.script("document.getElementById('test-connection').click();")
                mn.wait("document.getElementById('connection-test').children.length===2", timeout=35)
                report = mn.rpc('testConnection')
                assert all(item['reachable'] for item in report), report
                print('PASS: background connection diagnostics and UI reach both MAL servers', flush=True)
                # Exercise the native MalClient.token() path in an extension page;
                # injected fetch mocks cannot reveal Firefox receiver failures.
                result = mn.script("""
                    const done=arguments[arguments.length-1];
                    import(arguments[0]+'/lib/mal.js').then(async ({MalClient})=>{
                      const client=new MalClient(browser);
                      const original=client.fetcher;let nativeError;
                      client.fetcher=async(...args)=>{try{return await original(...args);}catch(error){nativeError=error.message;throw error;}};
                      try{await client.token({grant_type:'authorization_code',client_id:'00000000000000000000000000000000',code:'invalid-connectivity-probe',code_verifier:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'});return {unexpectedSuccess:true};}
                      catch(error){return {status:error.status,code:error.code,message:error.message,nativeError};}
                    }).then(done,error=>done({error:error.message}));
                """, True, [origin])
                assert result.get('status') in (400, 401, 403), result
                print('PASS: native MalClient token POST reaches MAL and returns an explicit credential error', flush=True)
            mn.command("WebDriver:SetWindowRect", {"width": 1280, "height": 1100})
            mn.screenshot("options.png")
            # Exercise actual form handlers, not just direct API calls.
            mn.script("document.getElementById('threshold').value='75'; document.getElementById('preferences').requestSubmit();")
            mn.wait("document.getElementById('notice').textContent.includes('preferences saved')")
            assert mn.rpc("view")["settings"]["threshold"] == 75
            print("PASS: extension loads, options render, preferences save", flush=True)
            fixture = f"http://127.0.0.1:{server.server_port}/watch"
            mn.navigate(fixture)
            time.sleep(8)
            mn.command("WebDriver:SwitchToFrame", {"id": 0})
            assert mn.script("const v=document.querySelector('video');return v && !v.paused && v.currentTime > 0 && v.duration === 180;")
            mn.command("WebDriver:SwitchToFrame", {"id": None})
            mn.navigate(origin + "/ui/options.html")
            mn.wait("document.getElementById('redirect')?.textContent.startsWith('https://')")
            view = mn.rpc("view")
            assert len(view["history"]) == 1, view
            record = view["history"][0]
            assert (record["title"], record["season"], record["episode"]) == ("Frieren", 1, 3), record
            assert record["playedSeconds"] > 0, record
            print("PASS: cross-origin iframe playback saves parent title + actual watch time", flush=True)
            # Seed a previous visit's saved progress, then use real page playback,
            # the injected prompt, same-site navigation, and iframe seeking.
            def save_position(position):
                mn.script("""const done=arguments[arguments.length-1];
                    browser.storage.local.get('state').then(async ({state})=>{
                      const record=state.history[arguments[0]];
                      Object.assign(record,{position:arguments[1],duration:180,playedSeconds:arguments[1],ranges:[[0,arguments[1]]],lastSeen:Date.now(),completed:false});
                      await browser.storage.local.set({state});done(true);
                    });""", True, [record['key'], position])

            save_position(60)
            mn.navigate(fixture + '?episode=5')
            mn.wait("document.querySelector('[data-anime-trail-resume]')?.shadowRoot?.textContent.includes('episode 3 at 1:00')")
            assert mn.script("return document.querySelector('[data-anime-trail-resume]').shadowRoot.querySelector('.primary').textContent==='Continue episode 3';")
            mn.screenshot('resume-wrong-episode.png')
            mn.command('WebDriver:SwitchToFrame', {'id': 0})
            assert mn.script("return document.querySelector('video').currentTime<15;")
            mn.command('WebDriver:SwitchToFrame', {'id': None})
            mn.script("document.querySelector('[data-anime-trail-resume]').shadowRoot.querySelector('.primary').click();")
            mn.wait("location.search==='?episode=3'")
            mn.wait("document.querySelector('iframe') !== null")
            mn.command('WebDriver:SwitchToFrame', {'id': 0})
            mn.wait("document.querySelector('video')?.currentTime>=60")
            mn.command('WebDriver:SwitchToFrame', {'id': None})
            print('PASS: mismatched-episode prompt navigates on this site and resumes the owning iframe', flush=True)

            mn.navigate(origin + '/ui/options.html')
            mn.wait("document.getElementById('redirect')?.textContent.startsWith('https://')")
            for other in mn.rpc('view')['history']:
                if other['key'] != record['key']:
                    mn.rpc('remove', key=other['key'])
            save_position(90)
            mn.navigate(fixture + '?episode=3')
            mn.wait("document.querySelector('[data-anime-trail-resume]')?.shadowRoot?.textContent.includes('Resume episode 3 at 1:30')")
            mn.screenshot('resume-timestamp.png')
            mn.script("document.querySelector('[data-anime-trail-resume]').shadowRoot.querySelector('.primary').click();")
            mn.command('WebDriver:SwitchToFrame', {'id': 0})
            mn.wait("document.querySelector('video')?.currentTime>=90")
            mn.command('WebDriver:SwitchToFrame', {'id': None})
            mn.wait("document.querySelector('[data-anime-trail-resume]')===null")
            print('PASS: timestamp prompt resumes real playback only after Continue is clicked', flush=True)

            mn.navigate(origin + '/ui/options.html')
            mn.wait("document.getElementById('redirect')?.textContent.startsWith('https://')")
            save_position(120)
            mn.navigate(fixture + '?episode=3')
            mn.wait("document.querySelector('[data-anime-trail-resume]')?.shadowRoot?.textContent.includes('Resume episode 3 at 2:00')")
            mn.script("document.querySelector('[data-anime-trail-resume]').shadowRoot.querySelector('.actions button:not(.primary)').click();")
            mn.wait("document.querySelector('[data-anime-trail-resume]')===null")
            time.sleep(6)
            assert mn.script("return document.querySelector('[data-anime-trail-resume]')===null;")
            mn.command('WebDriver:SwitchToFrame', {'id': 0})
            assert mn.script("return document.querySelector('video').currentTime<20;")
            mn.command('WebDriver:SwitchToFrame', {'id': None})
            print('PASS: Start here dismisses the prompt without seeking or nagging again', flush=True)
            mn.navigate(origin + '/ui/options.html')
            mn.wait("document.getElementById('redirect')?.textContent.startsWith('https://')")
            mn.script("document.querySelector('#history .small').click();")
            mn.wait("document.getElementById('notice').textContent.includes('Marked watched')")
            assert mn.rpc("view")["history"][0]["completed"] is True
            mn.rpc("remove", key=record["key"])
            assert len(mn.rpc("view")["history"]) == 0
            print("PASS: history renders, mark watched and local removal work", flush=True)
            mn.navigate(origin + "/ui/popup.html")
            mn.wait("document.getElementById('history').children.length > 0")
            mn.command("WebDriver:SetWindowRect", {"width": 720, "height": 950})
            # A standalone Zen tab has a sidebar; size the content viewport to the
            # same 410 CSS pixels that Firefox gives the actual toolbar popup.
            overhead = mn.script("return outerWidth-innerWidth;")
            mn.command("WebDriver:SetWindowRect", {"width": 410 + overhead, "height": 950})
            mn.screenshot("popup-empty.png")
            assert mn.script("return document.documentElement.scrollWidth <= innerWidth;")
            mn.script("document.getElementById('pause').click();")
            mn.wait("document.getElementById('tracking-label').textContent === 'Paused'")
            print("PASS: popup renders without overflow and pause control works", flush=True)
            mn.command("WebDriver:DeleteSession")
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            log.close()
            server.shutdown()
    print("Smoke test passed. Screenshots are in test-results/.", flush=True)


if __name__ == "__main__":
    main()
