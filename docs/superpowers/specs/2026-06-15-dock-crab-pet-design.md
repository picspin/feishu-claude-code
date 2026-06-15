# Dock Crab Pet Design

## Summary

Build a macOS-only Tauri desktop companion for `feishu-claude-code`: a small Q-style cyber hermit crab that lives near the Dock and acts as the user-facing control surface for the Feishu bridge.

The product rule is simple: if the crab is awake and waving, phone-side Feishu can talk to local Claude Code. Opening the crab starts the bridge and Cloudflare tunnel. Exiting the crab stops them.

## Goals

- Provide a friendly visible indicator for whether Feishu-to-Claude Code is available.
- Let the user start and stop the existing bridge + cloudflared tunnel from the crab app.
- Render a Dock-bound animated crab with distinct states: `sleep`, `wave-claw`, `crawl`, `wink`, `bubbling`, `dodge`, and `shrink`.
- Keep the existing Node bridge as the source of Feishu, Claude Code, and session behavior.
- Keep the first version focused on macOS only.

## Non-Goals

- Do not rewrite the bridge in Rust.
- Do not support Windows or Linux in the first version.
- Do not make a full-screen or free-roaming desktop pet.
- Do not require macOS login autostart.
- Do not embed Cloudflare tunnel tokens in source code, plist files, or packaged assets.

## Architecture

### Components

- `Tauri Crab App`: macOS desktop app with a transparent, always-on-top, Dock-adjacent window. It renders the crab sprite, handles click gestures, and invokes daemon commands.
- `Daemon Controller`: Tauri-side command layer that calls existing scripts such as `npm run daemon -- start`, `npm run daemon -- stop`, and `npm run daemon -- status`.
- `Node Feishu Bridge`: Existing webhook bridge. It continues to handle Feishu events, attachment download, Claude Code sessions, permission requests, and replies.
- `Cloudflared Tunnel`: Existing token-based tunnel started by daemon scripts. It forwards the configured public hostname to `http://127.0.0.1:8787`.
- `Status/Event Channel`: A small local status contract exposed by the bridge for the crab app. First version can use files under `~/.feishu-claude-code/runtime/status.json` and `events.jsonl`; a local HTTP health endpoint can replace this later.

### Process Model

On app launch:

1. Tauri checks current bridge and tunnel status.
2. If not running, Tauri calls `npm run daemon -- start`.
3. Tauri begins polling status and event files.
4. Crab state changes according to bridge health and message events.

On app exit:

1. Tauri calls `npm run daemon -- stop`.
2. Tauri closes the crab window.

If daemon start fails, the crab enters `sleep` with a red shell and exposes a log action.

## State Machine

| State | Trigger | Visual | Notes |
| --- | --- | --- | --- |
| `sleep` | No bridge process, no tunnel, Cloudflare offline, or health check failure | Red shell, tucked limbs, low glow | Default safe failure state |
| `wave-claw` | Bridge and tunnel are online; phone-side Feishu is usable | Idle crab waves claw once per minute | Baseline healthy state |
| `crawl` | Claude Code is thinking or streaming output | Crab crawls horizontally within Dock-safe bounds | Movement is limited to the Dock region |
| `wink` | Bridge receives image, audio, file, or other non-text input | Short wink animation | Signals "special input received" |
| `bubbling` | Claude reply completes, or user single-clicks crab | Speech bubbles / foam | Single-click can show or replay latest Feishu message summary |
| `dodge` | User double-clicks crab | Crab scuttles away briefly | Pure interaction effect, not a bridge state |
| `shrink` | User clicks crab more than 3 times in a burst | Crab shrinks into shell | Pure interaction effect, not a bridge state |

Priority order when multiple states compete:

1. `sleep`
2. `dodge` / `shrink`
3. `wink`
4. `crawl`
5. `bubbling`
6. `wave-claw`

## Dock-Bound Movement

The first version should not attempt full desktop roaming. It should constrain the crab to a small safe rectangle near the Dock:

- Width: current screen width minus margin.
- Height: approximately one Apple icon height plus animation padding.
- Y-position: just above the Dock when the Dock is bottom-aligned.
- If Dock position detection is unavailable, default to bottom-center safe area.

The crab should avoid hiding important app content by staying close to the Dock and using a compact visual footprint.

## Visual Asset Plan

Use generated raster assets first, with an SVG/Lottie path left open.

Recommended first asset set:

- `base.png`: neutral cyber hermit crab.
- `sleep.png`: red shell tucked state.
- `wave-claw.webp`: 2-4 frame waving animation.
- `crawl.webp`: 4-6 frame crawl loop.
- `wink.webp`: 2-3 frame wink.
- `bubbling.webp`: 3-5 frame foam/speech bubble loop.
- `dodge.webp`: short scuttle animation.
- `shrink.webp`: shrink-into-shell animation.

Target dimensions:

- Canvas: 128x128 px for source art.
- Display: around Apple icon size, roughly 64-96 px depending on screen scale.
- Transparent background.
- Consistent anchor point at the crab's base so state changes do not jump.

Prompt direction for image generation:

> Q-style cyber hermit crab desktop pet, cute but slightly futuristic, glossy red shell, cyan neon accents, tiny expressive eyes, transparent background, icon-sized sprite, macOS-friendly, readable at 64px, no text.

## Status/Event Contract

The crab needs a small bridge-observable contract. Suggested file format:

`~/.feishu-claude-code/runtime/status.json`

```json
{
  "bridge": "online",
  "tunnel": "online",
  "claude": "idle",
  "lastMessageType": "text",
  "lastEventAt": "2026-06-15T00:00:00.000Z",
  "lastError": null
}
```

`~/.feishu-claude-code/runtime/events.jsonl`

```jsonl
{"type":"message_received","messageType":"image","at":"2026-06-15T00:00:00.000Z"}
{"type":"claude_started","at":"2026-06-15T00:00:03.000Z"}
{"type":"claude_completed","at":"2026-06-15T00:00:12.000Z"}
```

This keeps the Tauri app decoupled from bridge internals.

## Error Handling

- If daemon start fails, show `sleep` and expose "Open logs".
- If tunnel is running but Cloudflare remains offline, show `sleep` with a red shell.
- If bridge is running but tunnel is offline, show `sleep`.
- If the latest Cloudflare ingress hostname does not match configured `publicBaseUrl`, expose a warning in the crab bubble.
- If status files are stale, treat the system as degraded and fall back to process/port checks.

## Testing Strategy

- Unit test the state reducer: status/events to crab state.
- Unit test click gesture handling: single click, double click, burst click.
- Integration test daemon controller with mocked command output.
- Manual macOS verification:
  - Start app and confirm `127.0.0.1:8787` and cloudflared metrics are listening.
  - Stop app and confirm bridge/tunnel exit.
  - Send text, image, and audio messages from Feishu and confirm state transitions.
  - Confirm crab stays inside Dock-safe bounds.

## Open Implementation Notes

- Tauri should not store secrets. It should read token indirectly through existing daemon scripts.
- The first version can poll every 1-2 seconds; event streaming can come later.
- The app should provide a visible "not autostarting at login" behavior by default, matching the current product decision.
- A future preference can add optional login autostart after explicit user opt-in.
