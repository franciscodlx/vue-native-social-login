#!/usr/bin/env node
// Publishes every public package under packages/ whose version is not on npm yet.
//
// pnpm packs each package (it rewrites `workspace:` ranges) and npm publishes the
// tarball, so trusted publishing (OIDC) and provenance work without a token.
// After a real publish it tags `<name>@<version>` and opens a GitHub release with
// that version's CHANGELOG section (needs GH_TOKEN).
//
//   node scripts/release.mjs            publish (CI, release workflow)
//   node scripts/release.mjs --dry-run  pack everything, dry-run what would publish (PRs)
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const root = join(import.meta.dirname, '..');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim();
}

/** 'published' | 'missing-version' | 'new-package' */
function registryState(name, version) {
  const exact = spawnSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' });
  if (exact.status === 0 && exact.stdout.trim() === version) return 'published';
  const any = spawnSync('npm', ['view', name, 'name'], { encoding: 'utf8' });
  return any.status === 0 && any.stdout.trim() === name ? 'missing-version' : 'new-package';
}

function changelogSection(dir, version) {
  const file = join(dir, 'CHANGELOG.md');
  if (!existsSync(file)) return '';
  const lines = readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.includes(version));
  if (start === -1) return '';
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim();
}

const packages = readdirSync(join(root, 'packages'))
  .map((d) => join(root, 'packages', d))
  .filter((dir) => existsSync(join(dir, 'package.json')))
  .map((dir) => ({ dir, ...JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }))
  .filter((p) => !p.private)
  // The core first: every provider package depends on it.
  .sort((a, b) => Number(b.name.endsWith('auth-core')) - Number(a.name.endsWith('auth-core')) || a.name.localeCompare(b.name));

const published = [];
const failures = [];

for (const pkg of packages) {
  const out = mkdtempSync(join(tmpdir(), 'pack-'));
  run('pnpm', ['pack', '--pack-destination', out], { cwd: pkg.dir });
  const tarball = join(out, readdirSync(out).find((f) => f.endsWith('.tgz')));
  const state = registryState(pkg.name, pkg.version);

  if (state === 'published') {
    console.log(`= ${pkg.name}@${pkg.version} ya está en npm (empaquetado OK)`);
    continue;
  }
  if (state === 'new-package' && !dryRun) {
    // Trusted publishing is configured per existing package, so the very first
    // version has to be published by hand (npm publish <tgz> --access public).
    failures.push(`${pkg.name}: no existe en npm; publica la primera versión a mano y configura trusted publishing`);
    continue;
  }

  const args = ['publish', tarball, '--access', 'public'];
  if (pkg.version.includes('-')) args.push('--tag', 'next');
  if (dryRun) args.push('--dry-run');
  console.log(`${dryRun ? '~' : '+'} ${pkg.name}@${pkg.version}${state === 'new-package' ? ' (paquete nuevo)' : ''}`);
  const result = spawnSync('npm', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    failures.push(`${pkg.name}@${pkg.version}: npm publish salió con ${result.status}`);
    continue;
  }
  if (!dryRun) published.push(pkg);
}

for (const pkg of published) {
  const tag = `${pkg.name}@${pkg.version}`;
  // Same line format as `changeset publish`, so tooling that parses it keeps working.
  console.log(`🦋  New tag: ${tag}`);
  const notes = changelogSection(pkg.dir, pkg.version) || `Ver ${pkg.name}/CHANGELOG.md`;
  const sha = process.env.RELEASE_SHA || run('git', ['rev-parse', 'HEAD']);
  const release = spawnSync(
    'gh',
    ['release', 'create', tag, '--target', sha, '--title', tag, '--notes', notes, ...(pkg.version.includes('-') ? ['--prerelease'] : [])],
    { stdio: 'inherit', cwd: root }
  );
  if (release.status !== 0) failures.push(`${tag}: publicado, pero no se pudo crear el release de GitHub`);
}

if (dryRun) console.log('\nDry run: nada se publicó.');
else if (!published.length && !failures.length) console.log('\nNada nuevo que publicar.');

if (failures.length) {
  console.error(`\n${failures.join('\n')}`);
  process.exit(1);
}
