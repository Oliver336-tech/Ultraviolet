import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scramjetPath } from '@mercuryworkshop/scramjet/path';
import { libcurlPath } from '@mercuryworkshop/libcurl-transport';
import { baremuxPath } from '@mercuryworkshop/bare-mux/node';

// Canonical distributions from MercuryWorkshop/Scramjet-App at
// f6f83cbc93091e47b9c357eb00ea289828aedf94. Do not rename engine globals,
// transform its WASM loader, or modify the transport's certificate validation.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = readFileSync(path.join(scramjetPath, 'scramjet.all.js'), 'utf8');
assert.equal(createHash('sha256').update(bundle).digest('hex'), '7d8de4965167a27b573bf7022190cfb68c9485d622c5a082e207a1092158d520', 'Pinned Scramjet bundle has changed');
assert.equal((bundle.match(/globalThis\.\$scramjetLoadClient=function/g) || []).length, 1, 'Unexpected Scramjet client export');
assert.ok(bundle.includes('version:"1.1.0"'), 'Only the pinned official runtime is supported');
// Preserve the original Request on the existing official request event. A new
// iframe navigation has no clientId, but its real referrer/policy still exist.
const requestEventAnchor = 'let E=new S(h,m.headers,e.body,e.method,e.destination,t);this.dispatchEvent(E);';
assert.equal(bundle.split(requestEventAnchor).length - 1, 1, 'Unexpected Scramjet request event construction');
let patchedBundle = bundle.replace(requestEventAnchor, 'let E=new S(h,m.headers,e.body,e.method,e.destination,t);E.originalRequest=e;this.dispatchEvent(E);');
// Worker constructors accept a WebIDL string, including URL objects from other
// realms. Convert before the engine's same-realm instanceof URL check.
for (const constructor of ['Worker', 'SharedWorker']) {
  const anchor = `e.Proxy("${constructor}",{construct(t){t.args[0]=`;
  assert.equal(patchedBundle.split(anchor).length - 1, 1, `Unexpected ${constructor} constructor hook`);
  const conversion = `if(!t.args.length)throw new TypeError("${constructor} requires a script URL");if("symbol"==typeof t.args[0])throw new TypeError("Cannot convert a Symbol value to a string");t.args[0]=String(t.args[0]);`;
  patchedBundle = patchedBundle.replace(anchor, `e.Proxy("${constructor}",{construct(t){${conversion}t.args[0]=`);
}
for (const [name, source] of [['scram', scramjetPath], ['libcurl', libcurlPath], ['baremux', baremuxPath]]) {
  const destination = path.join(root, 'public', name);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, { recursive: true });
  cpSync(path.join(source, '..', 'LICENSE'), path.join(destination, 'LICENSE'));
}
writeFileSync(path.join(root, 'public/scram/scramjet.all.js'), patchedBundle + '\n' + readFileSync(path.join(root, 'scripts/proxy-module-compat.js'), 'utf8'));
console.log('Installed canonical Scramjet 1.1.0 proxy assets');
