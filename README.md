# Slate Log

Lightweight, offline-first scene & take tracker for film shoots. Mac + Windows from one Rust codebase.

- Projects home screen (DaVinci-style picker), per-project scenes, **setups & takes**
- Fast take logging: Bad / Maybe / Good, camera, lens (presets + custom), INT/EXT, shoot day, timecode (auto or manual), **stopwatch durations**, camera + audio filenames with auto-increment, quick notes
- **Continuity stills** per scene (thumbnails, lightbox, captions, contact sheet in the report)
- Scene status (Not shot / Partial / Complete) + **wrap progress board**
- **CSV scene import** (with template), **daily report** view (print / save as PDF)
- SQLite storage on your machine — no account, no cloud, works offline on set
- Exports: Excel (All Takes, Good Selects, per-day stats), **PDF daily log**, **EDL selects timeline** (Resolve / Premiere / Avid)

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
