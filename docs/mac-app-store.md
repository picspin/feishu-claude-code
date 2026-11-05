# Dardanus Mac Distribution Guide

Two tracks:

1. **Direct / Developer ID** (current default): full pet + local bridge via `daemon.sh`, Apple Music control.
2. **Mac App Store**: sandboxed pet UI + outside-store bridge helper (see [`mas-helper-architecture.md`](./mas-helper-architecture.md)).

## Product identity

| Field | Value |
| --- | --- |
| Product name | Dardanus |
| Bundle id | `com.hilbert.dardanus` |
| Category | Utilities |
| Minimum macOS | 12.0 |
| Entitlements (direct) | `crab-pet/src-tauri/entitlements/app.entitlements` |
| Entitlements (MAS draft) | `crab-pet/src-tauri/entitlements/app-store.entitlements` |
| Privacy strings | `crab-pet/src-tauri/Info.plist` |

## One-click direct release (recommended)

```bash
export CODESIGN_IDENTITY="Developer ID Application: YOUR NAME (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_TEAM_ID="TEAMID"
export APPLE_APP_PASSWORD="app-specific-password"

cd ~/.claude/skills/feishu-claude-code
chmod +x scripts/release-dmg.sh
./scripts/release-dmg.sh
```

Or use a stored notary profile:

```bash
xcrun notarytool store-credentials "dardanus-notary" \
  --apple-id "you@example.com" --team-id "TEAMID" --password "app-specific-password"

export CODESIGN_IDENTITY="Developer ID Application: YOUR NAME (TEAMID)"
export NOTARY_PROFILE="dardanus-notary"
./scripts/release-dmg.sh
```

Outputs a signed + notarized + stapled DMG under:

```text
crab-pet/src-tauri/target/release/bundle/dmg-signed/Dardanus_<version>_signed.dmg
```

Flags:

| Env | Effect |
| --- | --- |
| `SKIP_BUILD=1` | Reuse existing tauri build |
| `SKIP_NOTARIZE=1` | Sign only |

## Manual build without notarization

```bash
cd crab-pet
npm install
npm run tauri -- build
```

## App Store path

Read **[`mas-helper-architecture.md`](./mas-helper-architecture.md)** first.

Summary blockers:

1. **Bridge daemon** (Node / launchd / cloudflared) cannot live inside App Sandbox as-is → ship helper outside MAS.
2. **`macOSPrivateApi`** for transparent always-on-top may fail Review → dual config for MAS.
3. **Accessibility** for magnetic snap needs a clear usage string (already in Info.plist).
4. **Apple Music** automation is preferred over Spotify: system app, stable AppleScript (`Music` / legacy `iTunes`).

### MAS checklist

- [ ] App Store Connect record for `com.hilbert.dardanus`
- [ ] 1024×1024 icon + Mac screenshots
- [ ] Pet binary with `mas-ui` feature (no daemon spawn)
- [ ] Helper install CTA when `/health` fails
- [ ] Sandbox entitlements (`app-store.entitlements`)
- [ ] Review notes explaining optional bridge helper
- [ ] Encryption export compliance answers

## Reviewer demo script (direct build)

1. Launch Dardanus → crab near Dock.
2. Right-click → Sound toggle → hear wave-claw cue.
3. Right-click → Music ▶/❚❚ → Apple Music play/pause (grant Automation if prompted).
4. Offline bridge → sleep; Wake starts local helper (direct build only).

## Related files

- Architecture: `docs/mas-helper-architecture.md`
- Release script: `scripts/release-dmg.sh`
- Entitlements: `crab-pet/src-tauri/entitlements/`
