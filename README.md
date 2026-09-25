# Slate Log

Lightweight, offline-first scene & take tracker for film shoots. Mac + Windows from one Rust codebase.

- Projects home screen (DaVinci-style picker), per-project scenes & takes
- Fast take logging: Bad / Maybe / Good, camera, lens (presets + custom), INT/EXT, shoot day, timecode, quick notes
- SQLite storage on your machine — no account, no cloud, works offline on set
- Excel export: All Takes, Good Selects, per-day stats sheets

Built with [Tauri v2](https://tauri.app/) (Rust backend, vanilla JS frontend). 3.7MB .dmg, ~5MB installed.

## Run in dev

```zsh
npm install
npm run tauri dev
```

## Build installers

```zsh
npm run tauri build
```

Output lands in `src-tauri/target/release/bundle/` (`.dmg`/`.app` on Mac, `.msi`/`.exe` on Windows).
Grab the latest ready-made Mac build from [Releases](../../releases).

> First launch on Mac: the app isn't Apple-signed yet, so right-click it → **Open** → **Open** once. After that it launches with a double-click like anything else.
