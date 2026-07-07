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
  assert.equal(capability.permissions?.includes('core:window:allow-set-size'), true);
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
  assert.equal(window?.width, 160);
  assert.equal(window?.height, 124);
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

test('app ensures the bridge daemon and wires free pet dragging', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');

  assert.match(app, /ensureDaemon\(\)/);
  assert.match(app, /maybeAutoWake/);
  assert.match(app, /createPetDrag/);
  assert.match(app, /frontmostWindowBounds/);
  assert.match(app, /canStartWindowDrag/);
  assert.match(app, /drag\.pointerDown/);
  assert.match(app, /drag\.pointerMove/);
  assert.match(app, /drag\.pointerUp/);
  assert.doesNotMatch(app, /stopDaemon\(\)/);
});

test('right click opens a pet menu with wake, setup, reload, and quit actions', () => {
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /id="crab-menu"/);
  assert.match(html, /data-menu-action="wake"/);
  assert.match(html, /data-menu-action="setup"/);
  assert.match(html, /data-menu-action="reload"/);
  assert.match(html, /data-menu-action="quit"/);
  assert.match(app, /showCrabMenu/);
  assert.match(app, /showSetupGuide/);
  assert.match(app, /ONBOARDING_KEY/);
  assert.match(app, /setPetWindowSize/);
  assert.match(app, /SETUP_CLIENTS/);
  assert.match(app, /saveSetupConfig/);
  assert.match(app, /openSetupGuide/);
  assert.match(app, /showTransientBubble/);
  assert.match(app, /wakeBridgeFromSleep/);
  assert.match(app, /contextmenu/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /startDaemon\(\)/);
  assert.match(app, /positionNearDock\(\)/);
  assert.match(app, /refresh\(\)/);
  assert.match(app, /quitApp\(\)/);
});

test('Tauri exposes a quit command for the pet menu', () => {
  const commands = readFileSync(new URL('../src-tauri/src/commands.rs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  const tauri = readFileSync(new URL('../src/tauri.ts', import.meta.url), 'utf8');

  assert.match(commands, /pub fn quit_app\(app:\s*tauri::AppHandle\)/);
  assert.match(commands, /app\.exit\(0\)/);
  assert.match(main, /commands::quit_app/);
  assert.match(tauri, /quitApp/);
});

test('setup guide renders IM choices and form controls', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const tauri = readFileSync(new URL('../src/tauri.ts', import.meta.url), 'utf8');
  const commands = readFileSync(new URL('../src-tauri/src/commands.rs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');

  assert.match(html, /id="setup-client-list"/);
  assert.match(html, /id="setup-language"/);
  assert.match(html, /id="setup-step-list"/);
  assert.match(html, /id="setup-form"/);
  assert.match(html, /id="setup-log"/);
  assert.match(app, /channel: 'feishu'/);
  assert.match(app, /channel: 'wechat'/);
  assert.match(app, /channel: 'wecom'/);
  assert.match(app, /type SetupLanguage = 'zh' \| 'en'/);
  assert.match(app, /打开开发者后台/);
  assert.match(app, /Copy app credentials/);
  assert.match(app, /Dardanus will coach you through Claude Code bridge setup/);
  assert.match(tauri, /saveSetupConfig/);
  assert.match(tauri, /openSetupGuide/);
  assert.match(commands, /save_setup_config/);
  assert.match(commands, /open_setup_guide/);
  assert.match(commands, /frontmost_window_bounds/);
  assert.match(main, /commands::save_setup_config/);
  assert.match(main, /commands::open_setup_guide/);
  assert.match(main, /commands::frontmost_window_bounds/);
});

test('tauri npm script pins macOS rust and clang tools for release builds', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  const tauriScript = packageJson.scripts?.tauri ?? '';
  assert.match(tauriScript, /\.rustup\/toolchains\/stable-aarch64-apple-darwin\/bin/);
  assert.match(tauriScript, /xcrun -f clang/);
  assert.match(tauriScript, /CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER/);
});
