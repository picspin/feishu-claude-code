# Crab Pet Assets

The production pet currently uses transparent PNG sprites under `../src/assets/`:

- `crab-neutral.png` - awake idle
- `crab-wave.png` - 5-second wave-claw one-shot
- `crab-crawl.png` - crawling/thinking pose
- `crab-wink.png` - recent non-text Feishu input
- `crab-bubble.png` - bubbling/recent activity
- `crab-shrink.png` - click-triggered and long-awake shell rest
- `crab-sleep.png` - true offline sleep, tucked shell with closed eyes and Zzz
- `hermit-crab-icon.png` - large source icon
- `hermit-crab-sprite-sheet.png` - prototype/reference state sheet

The Tauri app icon lives at `../src-tauri/icons/icon.png`.

Keep all pet-state images as RGBA PNGs with transparent corners. The renderer intentionally avoids panels, drop shadows, white backgrounds, or rounded card containers around the sprite.
