import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const packageInfo = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const version = packageInfo.version;
const source = join(projectRoot, 'release-notes', version + '.md');

if (!existsSync(source)) {
  throw new Error('Missing release notes for version ' + version + ': release-notes/' + version + '.md');
}

const builderNotes = join(projectRoot, 'resources', 'release-notes.md');
const publishedNotes = join(projectRoot, 'release', 'ShortCut-' + version + '-ReleaseNotes.md');

mkdirSync(dirname(builderNotes), { recursive: true });
mkdirSync(dirname(publishedNotes), { recursive: true });
copyFileSync(source, builderNotes);
copyFileSync(source, publishedNotes);

console.log('Prepared release notes for ShortCut ' + version);
