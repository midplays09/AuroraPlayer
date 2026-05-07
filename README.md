# Aurora 🎵

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

A sleek, premium local music player built with Tauri. Clean dark UI, spinning vinyl album art, live synced lyrics, Last.fm scrobbling — just point it at a folder and go.

---

## Features

- **Spinning vinyl album art** — rotates while playing, pauses when you pause
- **Live synced lyrics** — real-time line-by-line scrolling from local `.lrc` files or auto-fetched from NetEase, Musixmatch, or lrclib
- **Dynamic ambient color** — UI accent shifts to match the current album art
- **Last.fm scrobbling** — logs everything you listen to on your Last.fm profile
- **ID3 tag reading** — reads artist, album, and cover art from your audio files automatically
- **Songs / Albums / Artists views** — three ways to browse your library
- **Queue, shuffle, repeat** — full playback controls
- **Persistent config** — your folder, volume, settings and Last.fm session are saved to `config.json` and restored on next launch
- **macOS-style window controls** — traffic light buttons for close, minimize, maximize
- **Keyboard shortcuts** — control playback without touching the mouse

---

## Prerequisites

### 1. Rust
```bash
# macOS / Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows — download rustup-init.exe from https://rustup.rs
```

### 2. Node.js (v16+)
Download from [nodejs.org](https://nodejs.org). LTS recommended.

### 3. Platform dependencies

**Windows**
- [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select "Desktop development with C++"
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) — pre-installed on Windows 11

**macOS**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian)**
```bash
sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

---

## Getting Started

```bash
git clone https://github.com/midplays09/AuroraPlayer.git
cd AuroraPlayer
npm install
npm run tauri dev       # dev mode with hot reload
npm run tauri build     # production build
```

Built installer lands in `src-tauri/target/release/bundle/`.

---

## Config File

Aurora saves all your settings automatically to a `config.json` file:

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\aurora\config.json` |
| macOS | `~/Library/Application Support/aurora/config.json` |
| Linux | `~/.config/aurora/config.json` |

The following are persisted automatically — no manual saving needed:

- Last opened music folder (auto-reloaded on next launch)
- Volume level
- Shuffle and repeat state
- Lyrics panel open/closed
- Accent color
- All settings toggles (auto-fetch lyrics, blur lines, crossfade, EQ preset)
- Last.fm session (so you stay logged in)

To reset everything to defaults, just delete the `config.json` file.

---

## Loading Music

Click **Open Folder** or go to **Settings → Library → Browse**. Aurora scans the folder and loads all audio files it finds. The folder path is saved and reloaded automatically next time you open the app.

Supported formats: `MP3` `FLAC` `OGG` `WAV` `M4A` `AAC` `OPUS` `WMA`

---

## Lyrics

Aurora checks sources in this order:

### 1. Local `.lrc` file (best)
Place a `.lrc` next to your audio file with the same name:
```
Music/
├── Billie Jean.mp3
└── Billie Jean.lrc   ← picked up automatically
```

### 2. Auto-fetch (parallel race)
If no local file is found, Aurora fires requests to **three sources simultaneously** and uses whichever responds first:

| Source | Coverage |
|---|---|
| **NetEase** | Huge catalog, very fast, great for pop/mainstream |
| **Musixmatch** | Same database as Spotify, best overall coverage |
| **lrclib** | Open/crowdsourced fallback |

The source label in the lyrics panel shows you which one won. You can turn auto-fetch off in **Settings → Lyrics**.

---

## Last.fm Scrobbling

1. Create a free API app at [last.fm/api/account/create](https://www.last.fm/api/account/create)
2. Open **Settings → Last.fm** in Aurora
3. Paste your **API Key** and **API Secret** → click **Save Credentials**
4. Enter your Last.fm username and password → click **Connect**

A `✓ Scrobbled` badge appears in the player bar when a track is submitted. Your session is saved in `config.json` so you stay connected between launches.

**Scrobble rules (per Last.fm spec):**
- Submitted after 50% of the track, or 4 minutes — whichever comes first
- Tracks under 30 seconds are skipped
- Failed scrobbles are queued and retried automatically

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `⌘/Ctrl + →` | Next track |
| `⌘/Ctrl + ←` | Previous track |
| `↑` / `↓` | Volume up / down |
| `L` | Toggle lyrics panel |
| `S` | Toggle shuffle |

---

## Settings Reference

| Setting | What it does |
|---|---|
| Music Folder | Folder to load tracks from — saved and auto-reloaded |
| Auto-fetch lyrics | Fetch from NetEase/Musixmatch/lrclib when no `.lrc` found |
| Blur inactive lines | Fades non-active lyric lines |
| Crossfade | Smooth transition between tracks |
| Equalizer preset | Flat / Bass Boost / Vocal / Treble Boost |
| Accent color | UI highlight color — 5 presets or dynamic from album art |
| Last.fm | Connect account for scrobbling |

---

## Project Structure

```
AuroraPlayer/
├── src/
│   ├── index.html           # UI layout
│   ├── style.css            # Styles and animations
│   ├── app.js               # Playback, lyrics, config, Last.fm
│   ├── tauri-api.js         # Bundled @tauri-apps/api
│   └── jsmediatags.min.js   # ID3 tag reader
├── src-tauri/
│   ├── src/main.rs          # Rust entry point
│   ├── tauri.conf.json      # Tauri config
│   ├── Cargo.toml           # Rust deps
│   └── icons/               # App icons
├── LICENSE
└── README.md
```

---

## Troubleshooting

**Nothing clickable in release build**
Set `"csp": null` in `src-tauri/tauri.conf.json`.

**Artist/album shows as Unknown**
Your files may not have ID3 tags. Use [MusicBrainz Picard](https://picard.musicbrainz.org/) (free) to tag them.

**Lyrics not found**
Make sure your files have proper artist/title tags — that's what Aurora searches with. Or drop a `.lrc` file next to the audio file.

**Config not saving**
Make sure the app has write access to the config directory. On Linux you may need to check `~/.config/aurora/` permissions.

**Build error: `custom-protocol` feature**
Your `src-tauri/Cargo.toml` needs:
```toml
[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

---

## Built With

- [Tauri](https://tauri.app) — native desktop shell
- [Rust](https://www.rust-lang.org) — backend
- [NetEase Cloud Music API](https://github.com/Binaryify/NeteaseCloudMusicApi) — lyrics
- [Musixmatch](https://www.musixmatch.com) — lyrics
- [lrclib.net](https://lrclib.net) — lyrics fallback
- [jsmediatags](https://github.com/nicktindall/jsmediatags) — ID3 tags
- [Last.fm API](https://www.last.fm/api) — scrobbling
- [Syne](https://fonts.google.com/specimen/Syne) + [DM Sans](https://fonts.google.com/specimen/DM+Sans) — fonts

---

© 2025 midplays09 — GNU GPL v3
