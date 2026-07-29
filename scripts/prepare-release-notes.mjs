import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const packageInfo = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
const currentVersion = packageInfo.version;
const notesDirectory = join(projectRoot, 'release-notes');
const currentNotes = join(notesDirectory, currentVersion + '.md');

if (!existsSync(currentNotes)) {
  throw new Error('Missing release notes for version ' + currentVersion + ': release-notes/' + currentVersion + '.md');
}

const builderNotes = join(projectRoot, 'resources', 'release-notes.md');
const releaseDirectory = join(projectRoot, 'release');
mkdirSync(dirname(builderNotes), { recursive: true });
mkdirSync(releaseDirectory, { recursive: true });
copyFileSync(currentNotes, builderNotes);

const noteFiles = readdirSync(notesDirectory)
  .filter((name) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.md$/.test(name))
  .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }));

const versions = noteFiles.map((name) => {
  const version = basename(name, '.md');
  const source = join(notesDirectory, name);
  const notes = readFileSync(source, 'utf8').trim();
  copyFileSync(source, join(releaseDirectory, 'ShortCut-' + version + '-ReleaseNotes.md'));
  return { version, notes };
});

writeFileSync(
  join(releaseDirectory, 'release-notes.json'),
  JSON.stringify({ latest: currentVersion, versions }, null, 2) + '\n',
  'utf8',
);

console.log('Prepared release notes for ShortCut ' + currentVersion + ' (' + versions.length + ' versions)');
