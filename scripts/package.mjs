/** Reproducible browser-specific archives; no credentials or dev tools are shipped. */
import {cp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import AdmZip from 'adm-zip';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'extension');
const manifest = JSON.parse(await readFile(path.join(source, 'manifest.json'), 'utf8'));
const output = path.join(root, 'dist');
await mkdir(output, {recursive: true});

async function addFiles(zip, directory, prefix = '') {
  const entries = (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const filename = path.join(directory, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) await addFiles(zip, filename, name + '/');
    else if (entry.isFile()) {
      zip.addFile(name, await readFile(filename));
      const file = zip.getEntry(name);
      file.header.time = new Date(2026, 0, 1);
      file.attr = 0o100644 << 16;
    }
  }
}

for (const browser of ['firefox', 'chrome']) {
  const directory = path.join(output, browser);
  await rm(directory, {recursive: true, force: true});
  await cp(source, directory, {recursive: true, filter: filename => !path.basename(filename).startsWith('.')});
  const config = structuredClone(manifest);
  if (browser === 'chrome') {
    delete config.browser_specific_settings;
    config.minimum_chrome_version = '120';
    config.background = {service_worker: 'background.js', type: 'module'};
    config.icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/trail-${size}.png`]));
    config.action.default_icon = config.icons;
  }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(config, null, 2) + '\n');
  const zip = new AdmZip();
  await addFiles(zip, directory);
  // Keep the original Firefox archive name for existing install/smoke workflows.
  const name = `anime-trail-${manifest.version}${browser === 'chrome' ? '-chrome' : ''}.zip`;
  const bytes = zip.toBuffer();
  await writeFile(path.join(output, name), bytes);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(output, name + '.sha256'), `${checksum}  ${name}\n`);
  console.log(`Built dist/${name} and dist/${browser}/ (${bytes.length.toLocaleString()} bytes)`);
}
