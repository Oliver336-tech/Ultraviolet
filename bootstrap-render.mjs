// Reconstruct the pinned upstream source and apply this public ad-free overlay.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(root, 'app');
const upstream = '819f1fdd0c4b67763973ac3555189f7ca9121155';
function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', env: process.env });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})${capture ? ': '+result.stderr : ''}`);
  return result.stdout;
}
if (existsSync(app)) rmSync(app, { recursive: true, force: true });
mkdirSync(app);
run('git', ['init', '-q'], app);
run('git', ['remote', 'add', 'origin', 'https://github.com/PeteZah-Games/PeteZahGames.git'], app);
run('git', ['fetch', '--depth', '1', 'origin', upstream], app);
run('git', ['checkout', '--detach', 'FETCH_HEAD'], app);
const manifest = JSON.parse(readFileSync(path.join(root, 'overlay.json'), 'utf8'));
for (const file of manifest.deleted) rmSync(path.join(app, file), { force: true });
for (const file of manifest.files) {
  if (path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Invalid source path');
  mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
  cpSync(path.join(root, 'overlay', file), path.join(app, file));
}
writeFileSync(path.join(app, 'SOURCE_EDITION.json'), JSON.stringify({ upstream, edition: 'ad-free', overlay: process.env.RENDER_GIT_COMMIT || null }, null, 2));
run('npm', ['ci', '--include=dev'], app);
run(process.execPath, ['scripts/render-build.mjs'], app);
// Use an explicit source allowlist. Never include data, uploads, environment
// secrets, installed packages, compiled artifacts or caches in the source offer.
const files = [...new Set([...run('git', ['ls-files'], app, true).trim().split('\n'), ...manifest.files, 'SOURCE_EDITION.json'])]
  .filter(file => existsSync(path.join(app, file)) && !/^(node_modules|data|uploads|dist|\.render)\//.test(file) && !/\/target\//.test(file) && (!/\.env(\.|$)/.test(file) || file.endsWith('.env.example')));
writeFileSync(path.join(root, 'source-files.txt'), files.join('\n')+'\n');
run('tar', ['-czf', 'source.tar.gz', '-T', path.join(root, 'source-files.txt')], app);
console.log('[build] Ad-free source offer and application are ready');
