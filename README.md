# Aurora 🎵

A sleek, premium local music player built with Tauri. Clean dark UI, spinning vinyl album art, live synced lyrics, Last.fm scrobbling, and no subscription required — just point it at a folder and go.

---

## Features

- **Spinning vinyl album art** — the album cover rotates while music plays, pauses when you pause
- **Live synced lyrics** — line-by-line lyrics that scroll in real time, sourced from local `.lrc` files or fetched automatically from [lrclib.net](https://lrclib.net)
- **Dynamic ambient color** — the UI accent color shifts to match the current album art
- **Last.fm scrobbling** — tracks what you listen to and sends it to your Last.fm profile
- **ID3 tag reading** — automatically reads artist, album, and cover art from your audio files
- **Songs / Albums / Artists views** — three ways to browse your library
- **Queue, shuffle, repeat** — full playback controls
- **macOS-style window controls** — red/yellow/green traffic light buttons for close, minimize, maximize
- **Keyboard shortcuts** — control playback without touching the mouse
- **Accent color picker** — five color options in settings to personalize the UI

---

## Prerequisites

You need these installed before you can run or build Aurora.

### 1. Rust
```bash
# macOS / Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows
# Download and run rustup-init.exe from https://rustup.rs
```

### 2. Node.js (v16 or newer)
Download from [nodejs.org](https://nodejs.org). The LTS version is recommended.

### 3. Platform dependencies

**Windows**
- [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select "Desktop development with C++"
- [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) — usually already installed on Windows 11

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
# 1. Install dependencies
npm install

# 2. Run in development mode (opens the app with hot reload)
npm run tauri dev

# 3. Build a production installer
npm run tauri build
```

The built installer will be in `src-tauri/target/release/bundle/`.

---

## Loading Your Music

Click **Open Folder** in the top right, or go to **Settings → Library → Browse** and select the folder where your music files live. Aurora will scan it and load everything it finds.

Supported formats: `MP3` `FLAC` `OGG` `WAV` `M4A` `AAC` `OPUS` `WMA`

---

## Lyrics

Aurora looks for lyrics in two places, in this order:

### 1. Local `.lrc` file (synced, best quality)

Put a `.lrc` file in the same folder as your audio file with the exact same name:

```
Music/
├── Billie Jean.mp3
└── Billie Jean.lrc   ← Aurora picks this up automatically
```

Synced `.lrc` files have timestamps on each line so lyrics scroll in real time. You can find `.lrc` files for most songs on [lrclib.net](https://lrclib.net) or [syair.info](https://syair.info).

### 2. Auto-fetch from lrclib.net

If no `.lrc` file is found, Aurora automatically searches [lrclib.net](https://lrclib.net) using the track's artist and title (read from ID3 tags). This requires an internet connection. Synced lyrics are preferred; plain lyrics are used as a fallback.

You can turn auto-fetch off in **Settings → Lyrics**.

---

## Last.fm Scrobbling

Aurora can log every track you listen to on [Last.fm](https://www.last.fm).

### Setup

1. Go to [last.fm/api/account/create](https://www.last.fm/api/account/create) and create a free API application — name it anything you like
2. Copy your **API Key** and **API Secret**
3. Open **Settings → Last.fm** in Aurora
4. Paste in your API Key and Secret, then click **Save Credentials**
5. Enter your Last.fm username and password and click **Connect to Last.fm**

A `✓ Scrobbled` badge will appear in the player bar each time a track is submitted.

### How scrobbling works

- **Now Playing** is sent as soon as a track starts
- A **scrobble** is submitted once you've listened to 50% of the track, or 4 minutes — whichever comes first (this follows Last.fm's official rules)
- Tracks under 30 seconds are never scrobbled
- If a scrobble fails (e.g. no internet), it's queued and retried automatically

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `⌘ →` / `Ctrl →` | Next track |
| `⌘ ←` / `Ctrl ←` | Previous track |
| `↑` | Volume up |
| `↓` | Volume down |
| `L` | Toggle lyrics panel |
| `S` | Toggle shuffle |

---

## Settings

Open settings with the gear icon in the top right corner.

| Setting | What it does |
|---|---|
| Music Folder | The folder Aurora loads tracks from |
| Auto-fetch lyrics | Fetch lyrics from lrclib.net when no `.lrc` file is found |
| Blur inactive lines | Fades out lyrics lines that aren't currently playing |
| Crossfade | Smooth transition between tracks |
| Equalizer preset | Basic EQ presets (Flat, Bass Boost, Vocal, Treble Boost) |
| Accent color | Changes the purple highlight color throughout the UI |
| Last.fm | Connect your Last.fm account for scrobbling |

---

## Project Structure

```
aurora-player/
├── src/                     # Frontend (HTML, CSS, JS)
│   ├── index.html           # App layout and UI
│   ├── style.css            # All styles and animations
│   ├── app.js               # Playback, lyrics, Last.fm logic
│   ├── tauri-api.js         # Bundled @tauri-apps/api (auto-generated)
│   └── jsmediatags.min.js   # ID3 tag reader (bundled locally)
├── src-tauri/               # Rust / Tauri backend
│   ├── src/main.rs          # Rust entry point
│   ├── tauri.conf.json      # Tauri configuration
│   ├── Cargo.toml           # Rust dependencies
│   └── icons/               # App icons for all platforms
├── package.json
└── README.md
```

---

## Troubleshooting

**Nothing is clickable in the release build**
Make sure `"csp"` is set to `null` in `src-tauri/tauri.conf.json`. Tauri's Content Security Policy can silently block JavaScript in release mode.

**Artist/album shows as "Unknown"**
Aurora reads ID3 tags using `jsmediatags`. Make sure your files have proper tags embedded — you can edit them with [MusicBrainz Picard](https://picard.musicbrainz.org/) (free).

**Lyrics not found**
Check that your file has correct artist and title tags — that's what Aurora uses to search lrclib.net. Alternatively, place a `.lrc` file next to the audio file with the same name.

**Build error: `icons/icon.ico` not found**
The `src-tauri/icons/` folder must contain icon files. They're included in this repo — if they're missing, re-download the zip.

**`custom-protocol` feature error**
Make sure your `src-tauri/Cargo.toml` has this block:
```toml
[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

---

## Built With

- [Tauri](https://tauri.app) — native desktop app shell
- [Rust](https://www.rust-lang.org) — backend runtime
- [lrclib.net](https://lrclib.net) — free, open lyrics API
- [jsmediatags](https://github.com/nicktindall/jsmediatags) — ID3 tag reading
- [Last.fm API](https://www.last.fm/api) — scrobbling
- [Syne](https://fonts.google.com/specimen/Syne) + [DM Sans](https://fonts.google.com/specimen/DM+Sans) — typography

---

Aurora v1.0.0
