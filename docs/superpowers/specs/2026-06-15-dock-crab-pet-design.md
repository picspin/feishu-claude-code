# Dock Crab Pet Design

## Summary

Build a macOS-only Tauri desktop companion for `feishu-claude-code`: a small Q-style cyber hermit crab that lives near the Dock and acts as the user-facing control surface for the Feishu bridge.

The product rule is simple: if the crab is awake and waving, phone-side Feishu can talk to local Claude Code. Opening the crab starts the bridge and Cloudflare tunnel. Exiting the crab stops them.

## Project Structure

```
crab-pet/                          # Independent repository
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs               # Entry point, window management
│       ├── lib.rs
│       ├── daemon.rs             # Invoke daemon.sh scripts
│       ├── state.rs              # Crab state machine
│       ├── http_client.rs        # Poll bridge HTTP endpoints
│       └── commands.rs           # Tauri IPC commands
├── src/
│   ├── crab.ts                   # State rendering + animation
│   ├── gestures.ts               # Click gesture handling
│   ├── animation.ts              # Frame animation logic
│   └── app.ts                    # Frontend entry
├── assets/                       # PNG/WebP animation frames
│   ├── base.png
│   ├── sleep.png
│   ├── wave-claw.webp
│   ├── crawl.webp
│   ├── wink.webp
│   ├── bubbling.webp
│   ├── dodge.webp
│   └── shrink.webp
└── package.json
```

## Bridge Contract (New HTTP Endpoints)

Add two lightweight endpoints to existing bridge (no core logic changes):

### GET /health

Returns basic health check for load balancer friendliness.

```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### GET /status

Returns current bridge and Claude Code state.

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

### GET /events

Returns recent events as newline-delimited JSON (last 50 events).

```jsonl
{"type":"message_received","messageType":"image","at":"2026-06-15T00:00:00.000Z"}
{"type":"claude_started","at":"2026-06-15T00:00:03.000Z"}
{"type":"claude_completed","at":"2026-06-15T00:00:12.000Z"}
```

Event types:
- `message_received` — Feishu message arrived
- `claude_started` — Claude Code started processing
- `claude_completed` — Claude Code finished
- `error` — Bridge error occurred

## Goals

- Provide a friendly visible indicator for whether Feishu-to-Claude Code is available.
- Let the user start and stop the existing bridge + cloudflared tunnel from the crab app.
- Render a Dock-bound animated crab with distinct states.
- Keep the existing Node bridge as the source of truth.
- macOS only for first version.
- Crab app in independent repository.

## Non-Goals

- Do not rewrite the bridge in Rust.
- Do not support Windows or Linux in the first version.
- Do not make a full-screen or free-roaming desktop pet.
- Do not require macOS login autostart.
- Do not embed Cloudflare tunnel tokens in source code, plist files, or packaged assets.

## Architecture

### Components

1. **Tauri Crab App**: macOS desktop app with transparent, always-on-top, Dock-adjacent window. Renders crab sprite, handles click gestures, invokes daemon commands.
2. **Daemon Controller**: Tauri-side command layer that calls `~/.feishu-claude-code/scripts/daemon.sh` with `start`, `stop`, `status` actions.
3. **Bridge HTTP Endpoints**: New `/health`, `/status`, `/events` endpoints on existing bridge (port 8787).
4. **HTTP Polling**: Tauri backend polls `http://127.0.0.1:8787/status` every 1-2 seconds for state updates.

### Process Model

**On app launch:**
1. Tauri polls bridge `/health` endpoint.
2. If not healthy, Tauri calls `daemon.sh start`.
3. Tauri begins polling `/status` and `/events`.
4. Crab state changes according to bridge health and events.

**On app exit:**
1. Tauri calls `daemon.sh stop`.
2. Tauri closes the crab window.

**If daemon start fails:** crab enters `sleep` with red shell and exposes log action.

## State Machine

| State | Trigger | Visual | Notes |
|-------|---------|--------|-------|
| `sleep` | No bridge process, no tunnel, Cloudflare offline, or health check failure | Red shell, tucked limbs, low glow | Default safe failure state |
| `wave-claw` | Bridge and tunnel are online; phone-side Feishu is usable | Idle crab waves claw once per minute | Baseline healthy state |
| `crawl` | Claude Code is thinking or streaming output | Crab crawls horizontally within Dock-safe bounds | Movement limited to Dock region |
| `wink` | Bridge receives image, audio, file, or other non-text input | Short wink animation | Signals "special input received" |
| `bubbling` | Claude reply completes, or user single-clicks crab | Speech bubbles / foam | Single-click shows or replays latest Feishu message summary |
| `dodge` | User double-clicks crab | Crab scuttles away briefly | Pure interaction effect, not a bridge state |
| `shrink` | User clicks crab more than 3 times in a burst | Crab shrinks into shell | Pure interaction effect, not a bridge state |

**Priority order when multiple states compete:**
1. `sleep`
2. `dodge` / `shrink`
3. `wink`
4. `crawl`
5. `bubbling`
6. `wave-claw`

## Dock-Bound Movement

First version constrains crab to small safe rectangle near the Dock:
- Width: current screen width minus margin
- Height: approximately one Apple icon height plus animation padding
- Y-position: just above the Dock when Dock is bottom-aligned
- If Dock position detection unavailable, default to bottom-center safe area

Crab stays close to Dock and uses compact visual footprint to avoid hiding app content.

## Visual Assets

Use generated raster assets first, SVG/Lottie path left open.

**First asset set:**
- `base.png`: neutral cyber hermit crab
- `sleep.png`: red shell tucked state
- `wave-claw.webp`: 2-4 frame waving animation
- `crawl.webp`: 4-6 frame crawl loop
- `wink.webp`: 2-3 frame wink
- `bubbling.webp`: 3-5 frame foam/speech bubble loop
- `dodge.webp`: short scuttle animation
- `shrink.webp`: shrink-into-shell animation

**Target dimensions:**
- Canvas: 128x128 px for source art
- Display: around Apple icon size, roughly 64-96 px depending on screen scale
- Transparent background
- Consistent anchor point at crab's base so state changes don't jump

**Prompt direction for image generation:**

> Q-style cyber hermit crab desktop pet, cute but slightly futuristic, glossy red shell, cyan neon accents, tiny expressive eyes, transparent background, icon-sized sprite, macOS-friendly, readable at 64px, no text.

## Error Handling

- If daemon start fails, show `sleep` and expose "Open logs".
- If tunnel running but Cloudflare offline, show `sleep` with red shell.
- If bridge running but tunnel offline, show `sleep`.
- If latest Cloudflare hostname doesn't match configured `publicBaseUrl`, expose warning in crab bubble.
- If HTTP endpoints unreachable, fall back to process/port checks (port 8787).

## Testing Strategy

**Unit tests:**
- State reducer: status/events to crab state
- Click gesture handling: single click, double click, burst click
- HTTP client: request/parse `/status` and `/events`

**Integration tests:**
- Daemon controller with mocked command output
- End-to-end with mock bridge HTTP responses

**Manual macOS verification:**
1. Start app and confirm `127.0.0.1:8787` and cloudflared metrics are listening.
2. Stop app and confirm bridge/tunnel exit.
3. Send text, image, and audio messages from Feishu and confirm state transitions.
4. Confirm crab stays inside Dock-safe bounds.

## Implementation Notes

- Tauri should not store secrets. Read tokens indirectly through existing daemon scripts.
- First version polls every 1-2 seconds; event streaming can come later.
- App should NOT autostart at login by default (matches current product decision).
- Future preference can add optional login autostart after explicit user opt-in.
- Initialize Tauri project with `npm create tauri-app` using vanilla-ts template.

## Scope Boundaries

**In scope (first version):**
- macOS only
- Dock-adjacent positioning
- 7 crab states with animations
- Start/stop bridge + tunnel via daemon.sh
- Poll bridge HTTP endpoints for status

**Out of scope (future):**
- Windows/Linux support
- Full desktop roaming
- SSE/event streaming
- Login autostart
- Login items integration
