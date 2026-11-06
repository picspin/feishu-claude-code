# Dardanus MAS Helper Architecture

Goal: ship the **pet UI** on the Mac App Store while keeping the **Claude Code IM bridge** fully capable outside the sandbox.

```text
┌──────────────────────────────┐     HTTP localhost      ┌──────────────────────────────┐
│  Dardanus.app (MAS / UI)     │ ◄─────────────────────► │  dardanus-bridge (helper)    │
│  Tauri pet · SFX · Music.app │      :8787/status       │  Node bridge + channel workers│
│  Sandboxed · App Store       │      /events /health    │  launchd · optional tunnel    │
└──────────────────────────────┘                         └──────────────────────────────┘
         │                                                          │
         │ optional open URL                                        │ Feishu / Telegram / WeCom
         ▼                                                          ▼
   Music.app (Apple Events)                              Claude Code local sessions
```

## Why split

| Concern | Inside MAS app | Outside-store helper |
| --- | --- | --- |
| Transparent always-on-top pet | Possible with review risk if private API remains | N/A |
| Node.js + Claude Agent SDK | Blocked by sandbox | Allowed |
| launchd / cloudflared | Blocked | Allowed |
| Write `~/.feishu-claude-code` freely | Limited | Full home access |
| IM credentials | Prefer helper-owned store | Yes |
| Apple Music control | OK with Automation entitlement | Optional |

## Components

### A. `Dardanus.app` (MAS track)

**Responsibilities**

- Render crab states from `GET /status` + `GET /events`
- Sound effects, drag, onboarding UI copy
- Apple Music play/pause/next via Apple Events
- Deep-link / “Install helper” button when bridge offline

**Must not**

- `exec` `daemon.sh`, Node, or cloudflared
- Install LaunchAgents under sandbox expectations for review

**Feature flag**

```text
cfg: mas-ui   (Cargo feature / compile-time)
  - daemon invoke commands become no-ops or return install URL
  - Wake shows “Open helper installer” instead of start_daemon
```

### B. `dardanus-bridge` helper (direct / Homebrew / pkg)

**Responsibilities**

- Current root project: `src/main.ts`, Telegram/WeCom workers, `scripts/daemon.sh`
- Own LaunchAgent labels under `com.hilbert.dardanus.bridge` (rename later from `com.feishu-claude-code.*`)
- Serve stable localhost contract on `127.0.0.1:8787`

**Distribution options**

1. GitHub Release `.pkg` / notarized zip
2. Homebrew tap `brew install hilbert/tap/dardanus-bridge`
3. Same monorepo `npm run daemon` for power users

### C. Contract (keep stable)

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | liveness |
| `GET /status` | bridge/tunnel/claude/lastMessageType |
| `GET /events` | recent JSONL events for wink/bubble |

Optional later:

| Endpoint | Purpose |
| --- | --- |
| `POST /control/wake` | helper-only restart (loopback ACL) |
| `GET /version` | helper semantic version for pet upgrade banner |

Bind to `127.0.0.1` only. Do not expose on LAN without auth.

## Migration phases

### Phase 0 — today (direct DMG)

- Single app still starts helper via `daemon.sh` (current behavior)
- Music.app + SFX shipped
- Use `scripts/release-dmg.sh` for Developer ID notarized DMG

### Phase 1 — extract helper package

- Publish bridge as standalone installer with same port contract
- Pet detects offline helper and shows install instructions
- Dual-mode: if helper already healthy, skip local start

### Phase 2 — MAS pet binary

- Build pet with `mas-ui` feature: no process spawn
- Sandbox entitlements: `app-store.entitlements`
- Remove or gate `macos-private-api` if Review rejects
- App Review notes: “Requires optional free Dardanus Bridge helper for Claude Code IM; pet works as status widget alone”

### Phase 3 — polish

- App Group / shared bookmarks only if needed
- Auto-update helper via Sparkle/Homebrew
- Unified first-run coach: install helper → pick IM → paste keys

## Security notes

- Loopback-only HTTP is intentional; treat it as local IPC.
- Helper must not listen on `0.0.0.0`.
- Secrets stay in `~/.feishu-claude-code/config.json` (helper side), never in iCloud MAS container by default.
- Music automation is user-initiated or opt-in Wake-music.

## Bundle IDs (recommended)

| Binary | Bundle ID |
| --- | --- |
| Pet (MAS) | `com.hilbert.dardanus` |
| Bridge helper | `com.hilbert.dardanus.bridge` |
| LaunchAgent bridge | `com.hilbert.dardanus.bridge` |
| LaunchAgent tunnel | `com.hilbert.dardanus.tunnel` |

## Acceptance criteria for MAS submission

- [ ] Pet launches without helper and stays in sleep with clear CTA
- [ ] With helper running, pet maps online/crawl/wink/bubbling correctly
- [ ] No sandboxed process launch of Node/cloudflared
- [ ] Music menu works with system Automation prompt
- [ ] Screenshots + review notes document helper dependency

## Non-goals (for first MAS cut)

- Shipping Claude Code itself inside the App Store app
- Feishu challenge webhook termination inside the sandbox
- Multi-user headless server mode
