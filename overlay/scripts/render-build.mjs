#!/usr/bin/env node
// Render's Node runtime serves the app; Mochi is an internal Rust asset proxy.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
const rustCache = process.env.RENDER === 'true'
  ? path.resolve(root, '../../.cache/petezah-rust')
  : path.join(root, '.render', 'rust-tools');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal || code})`));
    });
  });
}

async function hasCargo() {
  try {
    await run('cargo', ['--version'], { stdio: 'ignore' });
    await run('rustc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function ensureRust() {
  env.RUSTUP_TOOLCHAIN ||= env.MOCHI_RUST_TOOLCHAIN || '1.88.0';
  if (await hasCargo()) return;
  const tools = rustCache;
  env.CARGO_HOME ||= path.join(tools, 'cargo');
  env.RUSTUP_HOME ||= path.join(tools, 'rustup');
  env.PATH = `${path.join(env.CARGO_HOME, 'bin')}${path.delimiter}${env.PATH || ''}`;
  if (await hasCargo()) return;
  mkdirSync(tools, { recursive: true });
  const installer = path.join(tools, 'rustup-init.sh');
  const response = await fetch('https://sh.rustup.rs', {
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Rust installer download failed: ${response.status}`);
  writeFileSync(installer, await response.text());
  console.log('[build] Installing a minimal Rust toolchain');
  await run('sh', [installer, '-y', '--profile', 'minimal', '--no-modify-path',
    '--default-toolchain', env.RUSTUP_TOOLCHAIN]);
}

async function main() {
  await ensureRust();
  // Limit build parallelism and linking memory on the free build machine.
  env.CARGO_BUILD_JOBS ||= '2';
  env.CARGO_PROFILE_RELEASE_LTO ||= 'thin';
  env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS ||= '8';
  if (process.env.RENDER === 'true') env.CARGO_TARGET_DIR ||= path.join(rustCache, 'target');
  console.log('[build] Compiling the internal Mochi proxy');
  await run('cargo', ['build', '--locked', '--release', '--manifest-path', 'backend/mochi/Cargo.toml']);
  if (env.CARGO_TARGET_DIR) {
    const destination = path.join(root, 'backend/mochi/target/release');
    mkdirSync(destination, { recursive: true });
    cpSync(path.join(env.CARGO_TARGET_DIR, 'release/mochi'), path.join(destination, 'mochi'));
  }
  const firefox = path.join(root, 'public', 'firefox-wasm');
  if (!existsSync(path.join(firefox, 'gecko.wasm.zst')) ||
      !existsSync(path.join(firefox, 'chrome-assets.tar.zst'))) {
    console.log('[build] Installing the Firefox VM assets');
    await run(process.execPath, ['scripts/vendor-firefox-wasm.mjs']);
  }
  console.log('[build] Building the frontend');
  await run(npm, ['run', 'build']);
}

main().catch((error) => {
  console.error('[build]', error.message);
  process.exitCode = 1;
});
