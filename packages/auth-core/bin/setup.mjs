#!/usr/bin/env node
// Adds the native half of @franciscodlxdev/vue-native-auth-core to a Vue
// Native app (vue-native.dev):
//
//   npx vue-native-social-login setup --scheme myapp[,otherscheme]
//
// 1. Copies native/SocialLoginAuthSession.vue to app/native/. vue-native's
//    codegen only reads <native> blocks from the app's files, never from
//    node_modules, so the module has to live there.
// 2. Android: declares the two activities of the auth session and the
//    redirect scheme(s) in android/app/src/main/AndroidManifest.xml, between
//    markers, so running it again updates the block instead of duplicating it.
// iOS needs nothing: ASWebAuthenticationSession catches the scheme itself.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const START = '<!-- vue-native-social-login:start -->';
const END = '<!-- vue-native-social-login:end -->';
const QUERIES_START = '<!-- vue-native-social-login:queries:start -->';
const QUERIES_END = '<!-- vue-native-social-login:queries:end -->';
const MODULE_FILE = 'SocialLoginAuthSession.vue';
const ACTIVITY_PACKAGE = 'com.vuenative.core.GeneratedModules';

function usage(code = 0) {
  console.log(`Usage: npx vue-native-social-login setup --scheme <scheme[,scheme…]> [--root <app dir>]

  --scheme   URL scheme(s) of your redirects, e.g. "myapp" for myapp://callback.
             Use the https host of an App Link instead with --https-host.
  --https-host  Host of an https redirect (App Link), e.g. auth.example.com.
  --root     App directory (default: current directory).`);
  process.exit(code);
}

export function parseArgs(argv) {
  const options = { command: argv[0], schemes: [], httpsHosts: [], root: process.cwd() };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--scheme' && value) {
      options.schemes.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
      i++;
    } else if (arg === '--https-host' && value) {
      options.httpsHosts.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
      i++;
    } else if (arg === '--root' && value) {
      options.root = value;
      i++;
    } else if (arg === '--help' || arg === '-h') {
      options.command = 'help';
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  for (const scheme of options.schemes) {
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(scheme) || /^https?$/i.test(scheme)) {
      throw new Error(`Invalid scheme "${scheme}": use your app's own scheme (letters, digits, + . -), not http(s).`);
    }
  }
  return options;
}

/** The <activity> block for the manifest; `data` lines carry the redirect targets. */
export function activitiesBlock(schemes, httpsHosts) {
  const data = [
    ...schemes.map((s) => `                <data android:scheme="${s}" />`),
    ...httpsHosts.map((h) => `                <data android:scheme="https" android:host="${h}" />`),
  ].join('\n');
  const autoVerify = httpsHosts.length > 0 ? ' android:autoVerify="true"' : '';
  return `${START}
        <activity
            android:name="${ACTIVITY_PACKAGE}.SocialLoginAuthSessionActivity"
            android:exported="false"
            android:launchMode="singleTask"
            android:theme="@android:style/Theme.Translucent.NoTitleBar"
            android:configChanges="keyboard|keyboardHidden|orientation|screenLayout|screenSize|smallestScreenSize|uiMode" />
        <activity
            android:name="${ACTIVITY_PACKAGE}.SocialLoginRedirectActivity"
            android:exported="true"
            android:theme="@android:style/Theme.Translucent.NoTitleBar">
            <intent-filter${autoVerify}>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
${data}
            </intent-filter>
        </activity>
        ${END}`;
}

// Android 11+ package visibility: lets the app find a browser for Custom Tabs.
export const QUERIES_BLOCK = `${QUERIES_START}
    <queries>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.BROWSABLE" />
            <data android:scheme="https" />
        </intent>
    </queries>
    ${QUERIES_END}`;

function replaceBetween(text, start, end, block, anchor) {
  const from = text.indexOf(start);
  const to = text.indexOf(end);
  if (from !== -1 && to > from) {
    return text.slice(0, from) + block + text.slice(to + end.length);
  }
  const at = text.lastIndexOf(anchor);
  if (at === -1) {
    throw new Error(`AndroidManifest.xml has no ${anchor}`);
  }
  return `${text.slice(0, at)}    ${block}\n${text.slice(at)}`;
}

export function patchManifest(xml, schemes, httpsHosts) {
  let out = replaceBetween(xml, START, END, activitiesBlock(schemes, httpsHosts), '</application>');
  out = replaceBetween(out, QUERIES_START, QUERIES_END, QUERIES_BLOCK, '</manifest>');
  return out;
}

export function setup(options) {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  const changed = [];

  // 1. The native module, where the codegen can see it.
  const target = join(options.root, 'app', 'native', MODULE_FILE);
  mkdirSync(dirname(target), { recursive: true });
  const source = readFileSync(join(here, '..', 'native', MODULE_FILE), 'utf8').replace(
    '__VERSION__',
    pkg.version
  );
  writeFileSync(target, source);
  changed.push(relative(options.root, target));

  // 2. Android manifest.
  const manifest = join(options.root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
  if (existsSync(manifest)) {
    if (options.schemes.length === 0 && options.httpsHosts.length === 0) {
      throw new Error('Android needs the redirect scheme: pass --scheme myapp (or --https-host).');
    }
    const xml = readFileSync(manifest, 'utf8');
    const next = patchManifest(xml, options.schemes, options.httpsHosts);
    if (next !== xml) {
      writeFileSync(manifest, next);
      changed.push(relative(options.root, manifest));
    }
  }
  return changed;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage(1);
  }
  if (options.command !== 'setup') {
    usage(options.command === 'help' ? 0 : 1);
  }
  try {
    const changed = setup(options);
    console.log(`vue-native-social-login: updated\n${changed.map((f) => `  ${f}`).join('\n')}`);
    console.log('\nNext: rebuild the native app (vue-native run ios / android) so the codegen picks up the module.');
  } catch (error) {
    console.error(`vue-native-social-login: ${error.message}`);
    process.exit(1);
  }
}

// npx runs it through a symlink in node_modules/.bin.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  main();
}
