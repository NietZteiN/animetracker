import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import AdmZip from 'adm-zip';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(new URL(`../dist/${name}`, import.meta.url));
test('browser builds are reproducible and contain valid, isolated manifests and PNG icons', () => {
  const build = () => execFileSync(process.execPath, ['scripts/package.mjs'], {cwd: root});
  build();
  const version = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url))).version;
  const archives = [`anime-trail-${version}.zip`, `anime-trail-${version}-chrome.zip`];
  const originals = archives.map(read);
  build();
  archives.forEach((name, index) => {
    assert.deepEqual(read(name), originals[index]);
    assert.equal(read(name + '.sha256').toString(), `${createHash('sha256').update(read(name)).digest('hex')}  ${name}\n`);
    const zip = new AdmZip(read(name));
    const manifest = JSON.parse(zip.readAsText('manifest.json'));
    const chrome = name.includes('-chrome');
    assert.equal(manifest.background.type, 'module');
    assert.equal(manifest.background.service_worker, chrome ? 'background.js' : undefined);
    assert.equal(!!manifest.background.scripts, !chrome);
    assert.equal(!!manifest.browser_specific_settings, !chrome);
    assert.equal(manifest.content_scripts[0].js[0], 'lib/browser.js');
    for (const script of manifest.content_scripts[0].js) assert.ok(zip.getEntry(script));
    for (const [size, icon] of Object.entries(manifest.icons)) {
      assert.ok(zip.getEntry(icon));
      if (chrome) {
        const png = zip.readFile(icon);
        assert.equal(png.subarray(1, 4).toString(), 'PNG');
        assert.equal(png.readUInt32BE(16), Number(size));
        assert.equal(png.readUInt32BE(20), Number(size));
      }
    }
    assert.ok(zip.getEntries().every(entry => !/node_modules|tests\/|test-results|package-lock/.test(entry.entryName)));
  });
});
