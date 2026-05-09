<div align="center">

```
░█████╗░██╗   ██╗██████╗  ░█████╗░██████╗  ░█████╗░
██╔══██╗██║   ██║██╔══██╗██╔══██╗██╔══██╗██╔══██╗
███████║██║   ██║██████╔╝██║  ██║██████╔╝███████║
██╔══██║██║   ██║██╔══██╗██║  ██║██╔══██╗██╔══██║
██║  ██║╚██████╔╝██║  ██║╚█████╔╝██║  ██║██║  ██║
╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝ ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
```

**A sleek, memory-efficient local music player built with Tauri**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri-24C8D8?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Backend-Rust-orange?logo=rust)](https://www.rust-lang.org)
[![Discord](https://img.shields.io/badge/Discord-Join%20Server-5865F2?logo=discord&logoColor=white)](https://discord.gg/3Ns6TW8cKD)

</div>

---

## Features at a glance

```
┌─────────────────────────────────────────────────────────────────┐
│  🎵  Local music playback    MP3 FLAC OGG WAV M4A AAC OPUS WMA  │
│  💿  Spinning vinyl art      Rotates while playing               │
│  🎤  Live synced lyrics      NetEase → Musixmatch → lrclib       │
│  📋  Playlists               Create, manage, delete              │
│  🔁  On Repeat               Auto-playlist from your listen time │
│  🌐  Last.fm scrobbling      Full now-playing + scrobble support │
│  🎨  Dynamic UI color        Accent pulled from album art        │
│  ⚡  Low memory              Lazy loading, no leaks              │
│  💾  Persistent config       Everything saved to config.json     │
│  ⌨️  Keyboard shortcuts      Full playback control               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Memory usage (before vs after optimization) 
- This is an estimate!
```
Before fix   ████████████████████████░░░░░░░  ~22 GB  (500 tracks)
After fix    ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ~180 MB (500 tracks)

What was leaking:
  ✗ readBinaryFile() loading entire audio files into RAM for tag reading
  ✗ new Audio() for every track holding decoded buffers in memory
  ✗ URL.createObjectURL() blobs never revoked — leaked on every load
  ✗ Canvas elements left alive after colour sampling

What we do now:
  ✓ Read only first 256KB of each file for ID3 tags
  ✓ Throwaway Audio element detached immediately after duration read
  ✓ Single shared canvas for colour sampling (reused, never recreated)
  ✓ Art blob URLs stored in a Map, all revoked when folder changes
  ✓ Metadata loaded in batches of 8 with 50ms yield between batches
```

---

## Lyrics source performance

```
Source         Speed     Coverage      Type
─────────────────────────────────────────────
NetEase        ⚡⚡⚡⚡    ★★★★☆         Synced LRC
Musixmatch     ⚡⚡⚡      ★★★★★         Synced LRC
lrclib         ⚡⚡        ★★★☆☆         Synced + Plain

All three fire simultaneously — fastest response wins.
Falls back through the list if a source doesn't have the track.
Local .lrc files always take priority over all network sources.
```

---

## On Repeat — how it works

```
  You listen to tracks
         │
         ▼
  Aurora records seconds listened per track
  (tracked in memory, saved to config.json hourly)
         │
         ▼
  Tracks with 3+ minutes of total listen time
  get ranked by total listen time
         │
         ▼
  Top 25 tracks appear in On Repeat playlist
  Updated every hour automatically

  Example:
  ┌────────────────────────────┬─────────────┐
  │ Track                      │ Time played │
  ├────────────────────────────┼─────────────┤
  │ Billie Jean                │ 2.4h        │
  │ Bohemian Rhapsody          │ 1.8h        │
  │ Blinding Lights            │ 1.2h        │
  │ ...                        │ ...         │
  └────────────────────────────┴─────────────┘
```

---

## Prerequisites

### 1. Rust
```bash
# macOS / Linux
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Windows — download rustup-init.exe from https://rustup.rs
```

### 2. Node.js v16+
Download from [nodejs.org](https://nodejs.org) — LTS recommended.

### 3. Platform dependencies

**Windows** — [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Desktop development with C++) + [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

**macOS** — `xcode-select --install`

**Linux**
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
npm run tauri build     # production build → src-tauri/target/release/bundle/
```

---

## Config file

Aurora saves everything automatically. No manual saving needed.

```
Windows   %APPDATA%\aurora\config.json
macOS     ~/Library/Application Support/aurora/config.json
Linux     ~/.config/aurora/config.json
```

What's saved:
```
config.json
├── musicFolder        last opened folder (auto-reloads on launch)
├── volume             volume level 0–1
├── shuffle            true/false
├── repeat             0=off  1=all  2=one
├── lyricsVisible      sidebar lyrics panel open/closed
├── accentColor        hex colour string
├── autoLyrics         fetch lyrics from network
├── blurLyrics         blur inactive lyric lines
├── crossfade          crossfade between tracks
├── eqPreset           flat | bass | vocal | treble
├── playlists          all your playlists and their track lists
├── listenLog          per-track listen time for On Repeat
└── lastfm             session key, credentials, scrobble queue
```

---

## Loading music

Click **Open Folder** or go to **Settings → Library → Browse**. The folder is saved and reloaded automatically next launch.

Supported formats: `MP3` `FLAC` `OGG` `WAV` `M4A` `AAC` `OPUS` `WMA`

---

## Lyrics

Aurora checks sources in this order:

**1. Local .lrc file** — place it next to your audio with the same filename:
```
Music/
├── Billie Jean.mp3
└── Billie Jean.lrc   ← auto-detected
```

**2. Network (parallel race)** — all three fire at once, fastest wins:
- NetEase Cloud Music — huge catalog, very fast
- Musixmatch — same DB as Spotify, best coverage
- lrclib — open/crowdsourced fallback

Toggle auto-fetch in **Settings → Lyrics**.

**Full lyrics overlay** — press `F` or click the expand icon in the lyrics panel or player bar for a full-screen immersive lyrics view.

---

## Playlists

- Click **+** next to Playlists in the sidebar to create one
- **On Repeat** auto-playlist tracks your most-listened songs and updates every hour

---

## Last.fm Scrobbling

1. Create API app at [last.fm/api/account/create](https://www.last.fm/api/account/create)
2. Open **Settings → Last.fm**, paste your API Key + Secret → **Save Credentials**
3. Enter your username + password → **Connect**

Scrobble rules (per Last.fm spec): submitted at 50% playtime or 4 minutes, whichever comes first. Tracks under 30s skipped. Failed scrobbles are queued and retried automatically.

---

## Keyboard Shortcuts

```
Space         Play / Pause
Ctrl/⌘ →      Next track
Ctrl/⌘ ←      Previous track
↑ / ↓         Volume up / down
L             Toggle lyrics panel
F             Full-screen lyrics overlay
S             Toggle shuffle
R             Cycle repeat
M             Toggle mute
F5            Disabled (won't reload the app)
```

---

## Project Structure

```
AuroraPlayer/
├── src/
│   ├── index.html           UI layout — playlists, lyrics overlay, player
│   ├── style.css            All styles and animations
│   ├── app.js               Playback, lyrics, playlists, config, Last.fm
│   ├── tauri-api.js         Bundled @tauri-apps/api
│   └── jsmediatags.min.js   ID3 tag reader (local, no CDN)
├── src-tauri/
│   ├── src/main.rs          Rust entry point
│   ├── tauri.conf.json      Window config, allowlist, CSP
│   ├── Cargo.toml           Rust deps + features
│   └── icons/               App icons (all platforms)
├── LICENSE
└── README.md
```

---

## Troubleshooting

**Nothing clickable in release build** — set `"csp": null` in `src-tauri/tauri.conf.json`.

**High memory usage** — make sure you're using the latest `app.js`. The old version loaded entire audio files into RAM for tag reading.

**Artist/album shows Unknown** — your files may not have ID3 tags. Use [MusicBrainz Picard](https://picard.musicbrainz.org/) (free) to tag them.

**Lyrics not found** — check your files have artist/title tags. Or drop a `.lrc` file next to the audio file.

**Build error: custom-protocol** — `src-tauri/Cargo.toml` needs:
```toml
[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

---

## Built With

| | |
|---|---|
| [Tauri](https://tauri.app) | Native desktop shell |
| [Rust](https://www.rust-lang.org) | Backend runtime |
| [NetEase Cloud Music](https://github.com/Binaryify/NeteaseCloudMusicApi) | Lyrics source 1 |
| [Musixmatch](https://www.musixmatch.com) | Lyrics source 2 |
| [lrclib.net](https://lrclib.net) | Lyrics source 3 |
| [jsmediatags](https://github.com/nicktindall/jsmediatags) | ID3 tag reading |
| [Last.fm API](https://www.last.fm/api) | Scrobbling |
| [Syne](https://fonts.google.com/specimen/Syne) + [DM Sans](https://fonts.google.com/specimen/DM+Sans) | Typography |

---

<div align="center">

© 2026 midplays09 — GNU GPL v3

*Built because every music player either costs money or doesn't have a good UI.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Midplays09/auroraPlayer&type=Date&theme=dark)](https://www.star-history.com/#Midplays09/auroraPlayer&Date)

</div>
