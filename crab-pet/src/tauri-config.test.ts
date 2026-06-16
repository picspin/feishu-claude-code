import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('main window has Tauri IPC capability for crab commands', () => {
  const capability = JSON.parse(
    readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'),
  ) as {
    identifier?: string;
    windows?: string[];
    permissions?: string[];
  };

  assert.equal(capability.identifier, 'main-window');
  assert.deepEqual(capability.windows, ['main']);
  assert.equal(capability.permissions?.includes('core:default'), true);
  assert.equal(capability.permissions?.includes('core:window:allow-current-monitor'), true);
  assert.equal(capability.permissions?.includes('core:window:allow-outer-position'), true);
  assert.equal(capability.permissions?.includes('core:window:allow-outer-size'), true);
  assert.equal(capability.permissions?.includes('core:window:allow-scale-factor'), true);
  assert.equal(capability.permissions?.includes('core:window:allow-set-position'), true);
});

test('main window leaves enough room for the animated hermit crab', () => {
  const config = JSON.parse(
    readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
  ) as {
    app?: {
      macOSPrivateApi?: boolean;
      windows?: Array<{
        width?: number;
        height?: number;
        transparent?: boolean;
        alwaysOnTop?: boolean;
        backgroundColor?: [number, number, number, number];
        shadow?: boolean;
      }>;
    };
    bundle?: { icon?: string[] };
  };

  assert.equal(config.app?.macOSPrivateApi, true);
  const window = config.app?.windows?.[0];
  assert.equal(window?.width, 180);
  assert.equal(window?.height, 150);
  assert.equal(window?.transparent, true);
  assert.deepEqual(window?.backgroundColor, [0, 0, 0, 0]);
  assert.equal(window?.shadow, false);
  assert.equal(window?.alwaysOnTop, true);
  assert.deepEqual(config.bundle?.icon, ['icons/icon.png']);
});

test('Cargo enables the macOS private API feature required for transparency', () => {
  const cargoToml = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');

  assert.match(cargoToml, /tauri\s*=\s*\{[^}]*features\s*=\s*\[[^\]]*"macos-private-api"/s);
});

test('runtime explicitly clears macOS window background and shadow', () => {
  const rust = readFileSync(new URL('../src-tauri/src/window.rs', import.meta.url), 'utf8');

  assert.match(rust, /set_background_color\(Some\(Color\(0,\s*0,\s*0,\s*0\)\)\)/);
  assert.match(rust, /set_shadow\(false\)/);
});

test('bubbling interaction stays visible for roughly five seconds', () => {
  const animation = readFileSync(new URL('../src/animation.ts', import.meta.url), 'utf8');

  assert.match(animation, /state === 'shrink'[\s\S]*10_000/);
  assert.match(animation, /state === 'bubbling' \|\| state === 'crawl' \|\| state === 'dodge'[\s\S]*5_000/);
});

test('app triggers bubbling only through hover or hold intent', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');

  assert.match(app, /startBubblingIntent/);
  assert.match(app, /pointerenter/);
  assert.match(app, /mouseenter/);
  assert.match(app, /pointerdown/);
  assert.match(app, /pointerleave/);
  assert.doesNotMatch(app, /setInteraction\(gestures\.click\(\)\)/);
});

test('app ensures the bridge daemon and wires horizontal pet dragging', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');

  assert.match(app, /ensureDaemon\(\)/);
  assert.match(app, /createHorizontalPetDrag/);
  assert.match(app, /drag\.pointerDown/);
  assert.match(app, /drag\.pointerMove/);
  assert.match(app, /drag\.pointerUp/);
});

test('right click wakes the pet by relaunching the daemon and refreshing state', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');

  assert.match(app, /wakeBridgeFromSleep/);
  assert.match(app, /contextmenu/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /ensureDaemon\(\)/);
  assert.match(app, /positionNearDock\(\)/);
  assert.match(app, /refresh\(\)/);
});
