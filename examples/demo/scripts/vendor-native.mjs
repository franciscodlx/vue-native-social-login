#!/usr/bin/env node
// Copies the native framework (VueNativeCore for iOS and Android) that the
// installed @thelacanians/vue-native-cli bundles into ./native, as
// `vue-native create` does. It is not committed: 13 MB that only mirror the
// CLI version in package.json. Generated modules land inside it on build.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

// The CLI does not export package.json, so walk up the node_modules folders
// (pnpm hoists it to the repository root).
function findCliNative(from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', '@thelacanians', 'vue-native-cli', 'native');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

const app = join(import.meta.dirname, '..');
const source = findCliNative(app);
const target = join(app, 'native');

if (!source) {
  console.error('No @thelacanians/vue-native-cli install found: run pnpm install first.');
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`native/ vendored from ${source}`);
