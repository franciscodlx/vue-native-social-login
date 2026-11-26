import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs, patchManifest, setup } from '../../bin/setup.mjs';

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name">
        <activity android:name=".MainActivity" android:exported="true" />
    </application>
</manifest>
`;

function app(withAndroid = true): string {
  const root = mkdtempSync(join(tmpdir(), 'vn-setup-'));
  if (withAndroid) {
    const dir = join(root, 'android', 'app', 'src', 'main');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'AndroidManifest.xml'), MANIFEST);
  }
  return root;
}

const manifestOf = (root: string) =>
  readFileSync(
    join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8'
  );

describe('setup', () => {
  it('copies the native module into app/native with the package version', () => {
    const root = app(false);
    setup({ schemes: [], httpsHosts: [], root });

    const module = readFileSync(
      join(root, 'app', 'native', 'SocialLoginAuthSession.vue'),
      'utf8'
    );
    expect(module).toContain('<native platform="ios">');
    expect(module).toContain('<native platform="android">');
    expect(module).not.toContain('__VERSION__');
  });

  it('declares the activities and every scheme in the Android manifest', () => {
    const root = app();
    setup({ schemes: ['myapp', 'other'], httpsHosts: [], root });

    const xml = manifestOf(root);
    expect(xml).toContain('GeneratedModules.SocialLoginAuthSessionActivity');
    expect(xml).toContain('GeneratedModules.SocialLoginRedirectActivity');
    expect(xml).toContain('<data android:scheme="myapp" />');
    expect(xml).toContain('<data android:scheme="other" />');
    expect(xml).toContain('<queries>');
    // Inside <application>, queries inside <manifest>.
    expect(xml.indexOf('SocialLoginRedirectActivity')).toBeLessThan(
      xml.indexOf('</application>')
    );
    expect(xml.indexOf('<queries>')).toBeGreaterThan(
      xml.indexOf('</application>')
    );
  });

  it('replaces its own block when run again', () => {
    const once = patchManifest(MANIFEST, ['myapp'], []);
    const twice = patchManifest(once, ['newscheme'], []);

    expect(twice.match(/SocialLoginRedirectActivity/g)).toHaveLength(1);
    expect(twice.match(/<queries>/g)).toHaveLength(1);
    expect(twice).toContain('android:scheme="newscheme"');
    expect(twice).not.toContain('android:scheme="myapp"');
  });

  it('adds verified App Links for https hosts', () => {
    const xml = patchManifest(MANIFEST, [], ['auth.example.com']);
    expect(xml).toContain('android:autoVerify="true"');
    expect(xml).toContain(
      '<data android:scheme="https" android:host="auth.example.com" />'
    );
  });

  it('needs a scheme when the app has an Android project', () => {
    expect(() => setup({ schemes: [], httpsHosts: [], root: app() })).toThrow(
      /--scheme/
    );
  });
});

describe('parseArgs', () => {
  it('reads comma separated schemes', () => {
    expect(parseArgs(['setup', '--scheme', 'a, b']).schemes).toEqual([
      'a',
      'b',
    ]);
  });

  it('rejects http(s) and malformed schemes', () => {
    expect(() => parseArgs(['setup', '--scheme', 'https'])).toThrow();
    expect(() => parseArgs(['setup', '--scheme', '1bad'])).toThrow();
  });
});
