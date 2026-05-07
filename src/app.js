/* ─── Aurora Player — app.js ─────────────────────────── */

const audio = document.getElementById('audioEl');
let tracks = [];
let filteredTracks = [];
let currentIndex = -1;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0;
let isMuted = false;
let volume = 0.8;
let liked = new Set();
let lyricsVisible = true;
let syncedLyrics = [];
let plainLyrics = [];
let currentView = 'songs';

audio.volume = volume;

/* ─── Last.fm State ──────────────────────────────────── */
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
let lfm = {
  apiKey: '', apiSecret: '', sessionKey: '', username: '',
  enabled: false, nowPlayingSent: false, scrobbled: false,
  scrobbleThreshold: 0, pendingScrobbles: [],
};

function saveLfmState() {
  try { localStorage.setItem('aurora_lastfm', JSON.stringify(lfm)); } catch(e) {}
}
try {
  const saved = JSON.parse(localStorage.getItem('aurora_lastfm') || '{}');
  Object.assign(lfm, saved);
} catch(e) {}

/* ─── Folder Selection ───────────────────────────────── */
function selectFolder() {
  if (window.__TAURI__) {
    TauriAPI.dialog.open({ directory: true, multiple: false })
      .then(path => { if (path) loadFolderFromPath(path); })
      .catch(() => document.getElementById('folderInput').click());
  } else {
    document.getElementById('folderInput').click();
  }
}

function loadFolder(files) {
  const audioFiles = Array.from(files).filter(f =>
    /\.(mp3|flac|ogg|wav|m4a|aac|opus|wma)$/i.test(f.name)
  );
  const lrcFiles = {};
  Array.from(files).forEach(f => {
    if (/\.lrc$/i.test(f.name))
      lrcFiles[f.name.replace(/\.lrc$/i, '').toLowerCase()] = f;
  });
  tracks = audioFiles.map((f, i) => ({
    id: i, file: f, url: URL.createObjectURL(f),
    name: f.name.replace(/\.[^.]+$/, ''),
    artist: 'Unknown Artist', album: 'Unknown Album',
    duration: 0, art: null,
    lrcFile: lrcFiles[f.name.replace(/\.[^.]+$/, '').toLowerCase()] || null
  }));
  filteredTracks = [...tracks];
  tracks.forEach(t => loadMeta(t));
  renderTrackList(); renderQueue();
  updateFolderDisplay(tracks.length + ' tracks loaded');
}

async function loadFolderFromPath(dirPath) {
  try {
    const entries = await TauriAPI.fs.readDir(dirPath, { recursive: false });
    const audioExts = /\.(mp3|flac|ogg|wav|m4a|aac|opus|wma)$/i;
    const lrcExts = /\.lrc$/i;
    const lrcMap = {}, audioEntries = [];
    entries.forEach(e => {
      if (!e.name) return;
      if (lrcExts.test(e.name)) lrcMap[e.name.replace(/\.lrc$/i,'').toLowerCase()] = e.path;
      if (audioExts.test(e.name)) audioEntries.push(e);
    });
    tracks = audioEntries.map((e, i) => ({
      id: i, file: null, path: e.path,
      url: TauriAPI.tauri.convertFileSrc(e.path),
      name: e.name.replace(/\.[^.]+$/, ''),
      artist: 'Unknown Artist', album: 'Unknown Album',
      duration: 0, art: null,
      lrcPath: lrcMap[e.name.replace(/\.[^.]+$/,'').toLowerCase()] || null
    }));
    filteredTracks = [...tracks];
    tracks.forEach(t => loadMeta(t));
    renderTrackList(); renderQueue();
    updateFolderDisplay(dirPath);
  } catch(e) { console.error('readDir failed:', e); }
}

function updateFolderDisplay(text) {
  const el = document.getElementById('folderPathDisplay');
  if (el) el.textContent = text;
}

/* ─── Metadata ───────────────────────────────────────── */
function loadMeta(track) {
  const tmp = new Audio(track.url);
  tmp.addEventListener('loadedmetadata', () => {
    track.duration = tmp.duration;
    refreshTrackRow(track);
  });
  if (window.jsmediatags && track.file) {
    window.jsmediatags.read(track.file, {
      onSuccess(tag) {
        const t = tag.tags;
        if (t.title) track.name = t.title;
        if (t.artist) track.artist = t.artist;
        if (t.album) track.album = t.album;
        if (t.picture) {
          const { data, format } = t.picture;
          const blob = new Blob([new Uint8Array(data)], { type: format });
          track.art = URL.createObjectURL(blob);
        }
        refreshTrackRow(track);
        refreshQueue();
        // If this is the currently playing track, update the player bar art too
        if (currentIndex === track.id) updatePlayerUI();
      },
      onError() {}
    });
  } else if (track.path && window.__TAURI__) {
    // For Tauri paths, read binary and extract tags via jsmediatags from ArrayBuffer
    TauriAPI.fs.readBinaryFile(track.path).then(arr => {
      if (!window.jsmediatags) return;
      window.jsmediatags.read(new Blob([arr]), {
        onSuccess(tag) {
          const t = tag.tags;
          if (t.title) track.name = t.title;
          if (t.artist) track.artist = t.artist;
          if (t.album) track.album = t.album;
          if (t.picture) {
            const { data, format } = t.picture;
            track.art = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: format }));
          }
          refreshTrackRow(track);
          refreshQueue();
          if (currentIndex === track.id) updatePlayerUI();
        },
        onError() {}
      });
    }).catch(() => {});
  }
}

function refreshTrackRow(track) {
  const row = document.querySelector(`.track-row[data-id="${track.id}"]`);
  if (!row) return;
  row.querySelector('.track-title').textContent = track.name;
  row.querySelector('.track-artist').textContent = track.artist;
  row.querySelector('.track-album').textContent = track.album;
  row.querySelector('.track-dur').textContent = formatTime(track.duration);
  const thumb = row.querySelector('.track-thumb');
  if (track.art) thumb.innerHTML = `<img src="${track.art}" alt="">`;
  else thumb.innerHTML = musicSVG(14);
}

/* ─── Render ─────────────────────────────────────────── */
function renderTrackList() {
  const list = document.getElementById('trackList');
  if (!filteredTracks.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">${musicSVG(64)}</div><p>No tracks found</p></div>`;
    return;
  }
  list.innerHTML = filteredTracks.map((t, i) => `
    <div class="track-row${currentIndex === t.id ? ' active' : ''}" data-id="${t.id}" onclick="playTrack(${t.id})" style="animation-delay:${Math.min(i*0.02,0.5)}s">
      <div class="track-num">${currentIndex === t.id && isPlaying ? '▶' : i+1}</div>
      <div class="track-info">
        <div class="track-thumb">${t.art ? `<img src="${t.art}" alt="">` : musicSVG(14)}</div>
        <div class="track-titles"><div class="track-title">${esc(t.name)}</div></div>
      </div>
      <div class="track-artist">${esc(t.artist)}</div>
      <div class="track-album">${esc(t.album)}</div>
      <div class="track-dur">${formatTime(t.duration)}</div>
    </div>
  `).join('');
}

function renderQueue() {
  const list = document.getElementById('queueList');
  if (!tracks.length) { list.innerHTML = '<div class="queue-empty">No tracks loaded</div>'; return; }
  list.innerHTML = tracks.map((t, i) => `
    <div class="queue-item${currentIndex === t.id ? ' active' : ''}" onclick="playTrack(${t.id})">
      <span class="qi-num">${i+1}</span>
      <div class="qi-info">
        <div class="qi-title">${esc(t.name)}</div>
        <div class="qi-artist">${esc(t.artist)}</div>
      </div>
    </div>
  `).join('');
}

function refreshQueue() {
  document.querySelectorAll('.queue-item').forEach((el, i) => {
    const t = tracks[i]; if (!t) return;
    el.querySelector('.qi-title').textContent = t.name;
    el.querySelector('.qi-artist').textContent = t.artist;
  });
}

function renderAlbums() {
  const albums = {};
  tracks.forEach(t => {
    if (!albums[t.album]) albums[t.album] = { name: t.album, count: 0, art: t.art, tracks: [] };
    albums[t.album].count++;
    albums[t.album].tracks.push(t.id);
    if (!albums[t.album].art && t.art) albums[t.album].art = t.art;
  });
  document.getElementById('albumsGrid').innerHTML = Object.values(albums).map(a => `
    <div class="album-card" onclick="playAlbum(${JSON.stringify(a.tracks)})">
      <div class="album-art">${a.art ? `<img src="${a.art}" alt="">` : musicSVG(48)}</div>
      <div class="album-name">${esc(a.name)}</div>
      <div class="album-count">${a.count} tracks</div>
    </div>
  `).join('');
}

function renderArtists() {
  const artists = {};
  tracks.forEach(t => {
    if (!artists[t.artist]) artists[t.artist] = { name: t.artist, count: 0, art: t.art };
    artists[t.artist].count++;
    if (!artists[t.artist].art && t.art) artists[t.artist].art = t.art;
  });
  document.getElementById('artistsGrid').innerHTML = Object.values(artists).map(a => `
    <div class="album-card">
      <div class="album-art" style="border-radius:50%">${a.art ? `<img src="${a.art}" alt="" style="border-radius:50%">` : musicSVG(48)}</div>
      <div class="album-name">${esc(a.name)}</div>
      <div class="album-count">${a.count} tracks</div>
    </div>
  `).join('');
}

function playAlbum(trackIds) { if (trackIds.length) playTrack(trackIds[0]); }

/* ─── Playback ───────────────────────────────────────── */
function playTrack(id) {
  const track = tracks.find(t => t.id === id);
  if (!track) return;
  currentIndex = id;
  audio.src = track.url;
  audio.play();
  isPlaying = true;
  updatePlayerUI(); updateActiveRows(); renderQueue();
  loadLyrics(track); updateAmbient(track);
  lfm.nowPlayingSent = false;
  lfm.scrobbled = false;
  lfm.scrobbleThreshold = Math.min(track.duration / 2, 240);
  if (lfm.enabled) lfmUpdateNowPlaying(track);
}

function togglePlay() {
  if (!audio.src) return;
  if (isPlaying) { audio.pause(); isPlaying = false; }
  else { audio.play(); isPlaying = true; }
  updatePlayBtn(); updateSpinning();
}

function playNext() {
  if (!tracks.length) return;
  if (repeatMode === 2) { audio.currentTime = 0; audio.play(); return; }
  const idx = tracks.findIndex(t => t.id === currentIndex);
  const next = isShuffle
    ? Math.floor(Math.random() * tracks.length)
    : (idx + 1) % tracks.length;
  playTrack(tracks[next].id);
}

function playPrev() {
  if (!tracks.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const idx = tracks.findIndex(t => t.id === currentIndex);
  playTrack(tracks[(idx - 1 + tracks.length) % tracks.length].id);
}

function toggleShuffle() {
  isShuffle = !isShuffle;
  document.getElementById('shuffleBtn').classList.toggle('active', isShuffle);
}

function cycleRepeat() {
  repeatMode = (repeatMode + 1) % 3;
  const btn = document.getElementById('repeatBtn');
  btn.classList.toggle('active', repeatMode > 0);
  btn.title = ['Repeat Off', 'Repeat All', 'Repeat One'][repeatMode];
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`;
}

function seekTo(e) {
  const bar = document.getElementById('progressBar');
  const rect = bar.getBoundingClientRect();
  audio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * audio.duration;
}

function setVolume(e) {
  const bar = document.getElementById('volumeBar');
  const rect = bar.getBoundingClientRect();
  volume = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.volume = volume; isMuted = false; updateVolumeUI();
}

function toggleMute() { isMuted = !isMuted; audio.muted = isMuted; updateVolumeUI(); }

function toggleLike() {
  if (currentIndex < 0) return;
  if (liked.has(currentIndex)) liked.delete(currentIndex);
  else liked.add(currentIndex);
  document.getElementById('heartBtn').classList.toggle('liked', liked.has(currentIndex));
}

/* ─── UI Updates ─────────────────────────────────────── */
function updatePlayerUI() {
  const track = tracks.find(t => t.id === currentIndex);
  if (!track) return;
  document.getElementById('playerTrackName').textContent = track.name;
  document.getElementById('playerTrackArtist').textContent = track.artist;
  document.getElementById('heartBtn').classList.toggle('liked', liked.has(currentIndex));
  const art = document.getElementById('playerArt');
  art.innerHTML = track.art
    ? `<img src="${track.art}" alt=""><div class="vinyl-hole"></div>`
    : `<div class="art-placeholder">${musicSVG(28)}</div><div class="vinyl-hole"></div>`;
  updatePlayBtn(); updateSpinning();
}

function updatePlayBtn() {
  document.querySelector('.play-icon').style.display = isPlaying ? 'none' : '';
  document.querySelector('.pause-icon').style.display = isPlaying ? '' : 'none';
}

function updateSpinning() {
  document.getElementById('playerArt').classList.toggle('playing', isPlaying);
}

function updateActiveRows() {
  document.querySelectorAll('.track-row').forEach(r => {
    const active = parseInt(r.dataset.id) === currentIndex;
    r.classList.toggle('active', active);
    r.querySelector('.track-num').textContent = active ? '▶'
      : filteredTracks.findIndex(t => t.id === parseInt(r.dataset.id)) + 1;
  });
  document.querySelectorAll('.queue-item').forEach((r, i) => {
    r.classList.toggle('active', tracks[i] && tracks[i].id === currentIndex);
  });
}

function updateVolumeUI() {
  const pct = isMuted ? 0 : volume * 100;
  document.getElementById('volumeFill').style.width = pct + '%';
  document.getElementById('volumeThumb').style.left = pct + '%';
}

function updateAmbient(track) {
  const bg = document.getElementById('ambientBg');
  if (!track.art) {
    bg.style.background = 'radial-gradient(ellipse 60% 50% at 50% -10%, rgba(167,139,250,0.12), transparent 70%)';
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 8;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 8, 8);
      const d = ctx.getImageData(0, 0, 8, 8).data;
      let r=0, g=0, b=0;
      for (let i=0; i<d.length; i+=4) { r+=d[i]; g+=d[i+1]; b+=d[i+2]; }
      const n = d.length/4;
      const color = `rgba(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)},0.18)`;
      bg.style.background = `radial-gradient(ellipse 60% 50% at 50% -10%, ${color}, transparent 70%)`;
      document.documentElement.style.setProperty('--accent', rgbToHex(Math.round(r/n),Math.round(g/n),Math.round(b/n)));
      document.documentElement.style.setProperty('--accent-dim', `rgba(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)},0.15)`);
    } catch(e) {}
  };
  img.src = track.art;
}

function rgbToHex(r,g,b) { return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join(''); }

/* ─── Progress & Audio Events ────────────────────────── */
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressThumb').style.left = pct + '%';
  document.getElementById('currentTime').textContent = formatTime(audio.currentTime);
  document.getElementById('totalTime').textContent = formatTime(audio.duration);
  syncLyricLine(audio.currentTime);
  if (lfm.enabled && !lfm.scrobbled && lfm.scrobbleThreshold > 0 && audio.currentTime >= lfm.scrobbleThreshold) {
    lfm.scrobbled = true;
    const track = tracks.find(t => t.id === currentIndex);
    if (track) lfmScrobble(track, Math.floor(Date.now()/1000) - Math.floor(audio.currentTime));
  }
});
audio.addEventListener('ended', () => { if (repeatMode === 2) { audio.play(); return; } playNext(); });
audio.addEventListener('play', () => { isPlaying = true; updatePlayBtn(); updateSpinning(); updateActiveRows(); });
audio.addEventListener('pause', () => { isPlaying = false; updatePlayBtn(); updateSpinning(); });

/* ─── Lyrics ─────────────────────────────────────────── */
async function loadLyrics(track) {
  syncedLyrics = []; plainLyrics = [];
  const content = document.getElementById('lyricsContent');
  const src = document.getElementById('lyricsSource');
  content.innerHTML = `<div class="lyrics-idle">${musicSVG(32)}<p>Loading lyrics…</p></div>`;
  src.textContent = '';

  // 1. Local .lrc file — always wins
  if (track.lrcFile) {
    const text = await readFileAsText(track.lrcFile);
    parseLRC(text); src.textContent = 'Local .lrc'; renderLyricLines(); return;
  }
  if (track.lrcPath && window.__TAURI__) {
    try {
      const text = await TauriAPI.fs.readTextFile(track.lrcPath);
      parseLRC(text); src.textContent = 'Local .lrc'; renderLyricLines(); return;
    } catch(e) {}
  }

  if (!document.getElementById('autoLyrics').checked) {
    content.innerHTML = `<div class="no-lyrics"><p>No lyrics found</p></div>`; return;
  }

  // 2. Race multiple sources in parallel — fastest wins
  const artist = track.artist !== 'Unknown Artist' ? track.artist : '';
  const title = track.name;

  const result = await Promise.any([
    fetchFromNetEase(title, artist),
    fetchFromMusixmatch(title, artist),
    fetchFromLrclib(title, artist),
  ].map(p => p.catch(() => Promise.reject())));

  if (result) {
    if (result.synced) {
      parseLRC(result.synced);
      src.textContent = result.source + ' · synced';
      renderLyricLines();
    } else if (result.plain) {
      plainLyrics = result.plain.split('\n').filter(l => l.trim());
      src.textContent = result.source;
      renderPlainLyrics();
    }
  } else {
    content.innerHTML = `<div class="no-lyrics"><p>No lyrics found</p></div>`;
  }
}

// NetEase via public proxy — massive catalog, very fast
async function fetchFromNetEase(title, artist) {
  const q = encodeURIComponent(`${title} ${artist}`.trim());
  const res = await fetchWithTimeout(`https://netease-cloud-music-api-taupe-phi.vercel.app/search?keywords=${q}&limit=1`, 4000);
  if (!res.ok) throw new Error();
  const data = await res.json();
  const song = data?.result?.songs?.[0];
  if (!song) throw new Error();
  const lrcRes = await fetchWithTimeout(`https://netease-cloud-music-api-taupe-phi.vercel.app/lyric?id=${song.id}`, 4000);
  if (!lrcRes.ok) throw new Error();
  const lrcData = await lrcRes.json();
  const synced = lrcData?.lrc?.lyric;
  if (!synced || synced.includes('纯音乐') || synced.trim().length < 10) throw new Error();
  return { synced, source: 'NetEase' };
}

// Musixmatch via public community endpoint — no API key needed
async function fetchFromMusixmatch(title, artist) {
  const q = encodeURIComponent(`${title} ${artist}`.trim());
  const res = await fetchWithTimeout(`https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&namespace=lyrics_synched&subtitle_format=mxm&app_id=web-desktop-app-v1.0&usertoken=190523f77464fba06fa5f82a9bfab0571dac14793a5b43571c3f8f5&q_track=${encodeURIComponent(title)}&q_artist=${encodeURIComponent(artist)}&q_duration=&page_size=1`, 4000);
  if (!res.ok) throw new Error();
  const data = await res.json();
  const body = data?.message?.body?.macro_calls;
  const lyricsBody = body?.['track.subtitles.get']?.message?.body;
  const subtitle = lyricsBody?.subtitle_list?.[0]?.subtitle;
  if (!subtitle?.subtitle_body) throw new Error();
  // Convert Musixmatch JSON subtitle to LRC
  const lines = JSON.parse(subtitle.subtitle_body);
  const lrc = lines.map(l => {
    const t = l.time;
    const mins = String(Math.floor(t.minutes)).padStart(2,'0');
    const secs = String(Math.floor(t.seconds)).padStart(2,'0');
    const cents = String(Math.floor((t.hundredths || 0))).padStart(2,'0');
    return `[${mins}:${secs}.${cents}]${l.text}`;
  }).join('\n');
  return { synced: lrc, source: 'Musixmatch' };
}

// lrclib — fallback, slower but open
async function fetchFromLrclib(title, artist) {
  const q = encodeURIComponent(`${artist} ${title}`.trim());
  const res = await fetchWithTimeout(`https://lrclib.net/api/search?q=${q}`, 6000);
  if (!res.ok) throw new Error();
  const results = await res.json();
  const best = results?.[0];
  if (!best) throw new Error();
  if (best.syncedLyrics) return { synced: best.syncedLyrics, source: 'lrclib' };
  if (best.plainLyrics) return { plain: best.plainLyrics, source: 'lrclib' };
  throw new Error();
}

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(id));
}

function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsText(file);
  });
}

function parseLRC(text) {
  syncedLyrics = [];
  text.split('\n').forEach(line => {
    const m = line.match(/\[(\d+):(\d+)[.:](\d+)\](.*)/);
    if (m) {
      const time = parseInt(m[1])*60 + parseFloat(m[2]+'.'+m[3]);
      const txt = m[4].trim();
      if (txt) syncedLyrics.push({ time, text: txt });
    }
  });
  syncedLyrics.sort((a,b) => a.time - b.time);
}

function renderLyricLines() {
  const content = document.getElementById('lyricsContent');
  if (!syncedLyrics.length) { content.innerHTML = `<div class="no-lyrics"><p>No lyrics found</p></div>`; return; }
  content.innerHTML = syncedLyrics.map((l, i) =>
    `<div class="lyric-line" data-idx="${i}" data-time="${l.time}" onclick="seekToLyric(${l.time})">${esc(l.text)}</div>`
  ).join('');
}

function renderPlainLyrics() {
  document.getElementById('lyricsContent').innerHTML = plainLyrics.map(l =>
    `<div class="lyric-line near">${esc(l)}</div>`
  ).join('');
}

function syncLyricLine(currentTime) {
  if (!syncedLyrics.length) return;
  let activeIdx = -1;
  for (let i = 0; i < syncedLyrics.length; i++) {
    if (syncedLyrics[i].time <= currentTime + 0.3) activeIdx = i;
    else break;
  }
  if (activeIdx < 0) return;
  const lines = document.querySelectorAll('.lyric-line');
  const blur = document.getElementById('blurLyrics').checked;
  lines.forEach((el, i) => {
    el.classList.remove('active', 'blur', 'near');
    if (i === activeIdx) { el.classList.add('active'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else if (blur) el.classList.add(Math.abs(i-activeIdx) === 1 ? 'near' : 'blur');
    else if (Math.abs(i-activeIdx) <= 2) el.classList.add('near');
  });
}

function seekToLyric(time) { audio.currentTime = time; if (!isPlaying) { audio.play(); isPlaying = true; } }

/* ─── Filter / Search ────────────────────────────────── */
function filterTracks(query) {
  const q = query.toLowerCase();
  filteredTracks = q ? tracks.filter(t =>
    t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album.toLowerCase().includes(q)
  ) : [...tracks];
  renderTrackList();
}

/* ─── View Switching ─────────────────────────────────── */
function setView(name, btn) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (name === 'albums') renderAlbums();
  if (name === 'artists') renderArtists();
}

/* ─── Settings ───────────────────────────────────────── */
function toggleSettings() { document.getElementById('settingsOverlay').classList.toggle('open'); }
function closeSettings(e) { if (e.target === document.getElementById('settingsOverlay')) toggleSettings(); }

function setAccent(btn) {
  const color = btn.dataset.color;
  document.documentElement.style.setProperty('--accent', color);
  const r=parseInt(color.slice(1,3),16), g=parseInt(color.slice(3,5),16), b=parseInt(color.slice(5,7),16);
  document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.15)`);
  document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
}

/* ─── Lyrics Panel ───────────────────────────────────── */
function toggleLyricsPanel() {
  lyricsVisible = !lyricsVisible;
  document.getElementById('lyricsPanel').classList.toggle('hidden', !lyricsVisible);
  document.getElementById('lyricsToggleBtn').classList.toggle('active', lyricsVisible);
}

/* ─── Window Controls ────────────────────────────────── */
async function handleClose() {
  if (window.__TAURI__) await TauriAPI.window.appWindow.close();
}
async function handleMinimize() {
  if (window.__TAURI__) await TauriAPI.window.appWindow.minimize();
}
async function handleMaximize() {
  if (window.__TAURI__) await TauriAPI.window.appWindow.toggleMaximize();
}

/* ─── Keyboard Shortcuts ─────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight' && e.metaKey) playNext();
  if (e.code === 'ArrowLeft' && e.metaKey) playPrev();
  if (e.code === 'ArrowUp') { volume = Math.min(1, volume+0.05); audio.volume = volume; updateVolumeUI(); }
  if (e.code === 'ArrowDown') { volume = Math.max(0, volume-0.05); audio.volume = volume; updateVolumeUI(); }
  if (e.code === 'KeyL') toggleLyricsPanel();
  if (e.code === 'KeyS') toggleShuffle();
});

/* ─── Last.fm ────────────────────────────────────────── */
function md5(str) {
  function safeAdd(x,y){const lsw=(x&0xffff)+(y&0xffff);return(((x>>16)+(y>>16)+(lsw>>16))<<16)|(lsw&0xffff);}
  function bitRotateLeft(num,cnt){return(num<<cnt)|(num>>>(32-cnt));}
  function md5cmn(q,a,b,x,s,t){return safeAdd(bitRotateLeft(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b);}
  function md5ff(a,b,c,d,x,s,t){return md5cmn((b&c)|((~b)&d),a,b,x,s,t);}
  function md5gg(a,b,c,d,x,s,t){return md5cmn((b&d)|(c&(~d)),a,b,x,s,t);}
  function md5hh(a,b,c,d,x,s,t){return md5cmn(b^c^d,a,b,x,s,t);}
  function md5ii(a,b,c,d,x,s,t){return md5cmn(c^(b|(~d)),a,b,x,s,t);}
  function md5blks(s){const nblk=((s.length+8)>>6)+1,blks=[];for(let i=0;i<nblk*16;i++)blks[i]=0;for(let i=0;i<s.length;i++)blks[i>>2]|=s.charCodeAt(i)<<((i%4)*8);blks[s.length>>2]|=0x80<<((s.length%4)*8);blks[nblk*16-2]=s.length*8;return blks;}
  const x=md5blks(str);let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
  for(let i=0;i<x.length;i+=16){const aa=a,bb=b,cc=c,dd=d;a=md5ff(a,b,c,d,x[i],7,-680876936);d=md5ff(d,a,b,c,x[i+1],12,-389564586);c=md5ff(c,d,a,b,x[i+2],17,606105819);b=md5ff(b,c,d,a,x[i+3],22,-1044525330);a=md5ff(a,b,c,d,x[i+4],7,-176418897);d=md5ff(d,a,b,c,x[i+5],12,1200080426);c=md5ff(c,d,a,b,x[i+6],17,-1473231341);b=md5ff(b,c,d,a,x[i+7],22,-45705983);a=md5ff(a,b,c,d,x[i+8],7,1770035416);d=md5ff(d,a,b,c,x[i+9],12,-1958414417);c=md5ff(c,d,a,b,x[i+10],17,-42063);b=md5ff(b,c,d,a,x[i+11],22,-1990404162);a=md5ff(a,b,c,d,x[i+12],7,1804603682);d=md5ff(d,a,b,c,x[i+13],12,-40341101);c=md5ff(c,d,a,b,x[i+14],17,-1502002290);b=md5ff(b,c,d,a,x[i+15],22,1236535329);a=md5gg(a,b,c,d,x[i+1],5,-165796510);d=md5gg(d,a,b,c,x[i+6],9,-1069501632);c=md5gg(c,d,a,b,x[i+11],14,643717713);b=md5gg(b,c,d,a,x[i],20,-373897302);a=md5gg(a,b,c,d,x[i+5],5,-701558691);d=md5gg(d,a,b,c,x[i+10],9,38016083);c=md5gg(c,d,a,b,x[i+15],14,-660478335);b=md5gg(b,c,d,a,x[i+4],20,-405537848);a=md5gg(a,b,c,d,x[i+9],5,568446438);d=md5gg(d,a,b,c,x[i+14],9,-1019803690);c=md5gg(c,d,a,b,x[i+3],14,-187363961);b=md5gg(b,c,d,a,x[i+8],20,1163531501);a=md5gg(a,b,c,d,x[i+13],5,-1444681467);d=md5gg(d,a,b,c,x[i+2],9,-51403784);c=md5gg(c,d,a,b,x[i+7],14,1735328473);b=md5gg(b,c,d,a,x[i+12],20,-1926607734);a=md5hh(a,b,c,d,x[i+5],4,-378558);d=md5hh(d,a,b,c,x[i+8],11,-2022574463);c=md5hh(c,d,a,b,x[i+11],16,1839030562);b=md5hh(b,c,d,a,x[i+14],23,-35309556);a=md5hh(a,b,c,d,x[i+1],4,-1530992060);d=md5hh(d,a,b,c,x[i+4],11,1272893353);c=md5hh(c,d,a,b,x[i+7],16,-155497632);b=md5hh(b,c,d,a,x[i+10],23,-1094730640);a=md5hh(a,b,c,d,x[i+13],4,681279174);d=md5hh(d,a,b,c,x[i],11,-358537222);c=md5hh(c,d,a,b,x[i+3],16,-722521979);b=md5hh(b,c,d,a,x[i+6],23,76029189);a=md5hh(a,b,c,d,x[i+9],4,-640364487);d=md5hh(d,a,b,c,x[i+12],11,-421815835);c=md5hh(c,d,a,b,x[i+15],16,530742520);b=md5hh(b,c,d,a,x[i+2],23,-995338651);a=md5ii(a,b,c,d,x[i],6,-198630844);d=md5ii(d,a,b,c,x[i+7],10,1126891415);c=md5ii(c,d,a,b,x[i+14],15,-1416354905);b=md5ii(b,c,d,a,x[i+5],21,-57434055);a=md5ii(a,b,c,d,x[i+12],6,1700485571);d=md5ii(d,a,b,c,x[i+3],10,-1894986606);c=md5ii(c,d,a,b,x[i+10],15,-1051523);b=md5ii(b,c,d,a,x[i+1],21,-2054922799);a=md5ii(a,b,c,d,x[i+8],6,1873313359);d=md5ii(d,a,b,c,x[i+15],10,-30611744);c=md5ii(c,d,a,b,x[i+6],15,-1560198380);b=md5ii(b,c,d,a,x[i+13],21,1309151649);a=md5ii(a,b,c,d,x[i+4],6,-145523070);d=md5ii(d,a,b,c,x[i+11],10,-1120210379);c=md5ii(c,d,a,b,x[i+2],15,718787259);b=md5ii(b,c,d,a,x[i+9],21,-343485551);a=safeAdd(a,aa);b=safeAdd(b,bb);c=safeAdd(c,cc);d=safeAdd(d,dd);}
  function rhex(n){let s='',j=0;for(;j<4;j++)s+=('0123456789abcdef').charAt((n>>(j*8+4))&0x0f)+('0123456789abcdef').charAt((n>>(j*8))&0x0f);return s;}
  return rhex(a)+rhex(b)+rhex(c)+rhex(d);
}

function lfmSign(params) {
  const keys = Object.keys(params).filter(k=>k!=='format').sort();
  return md5(keys.map(k=>k+params[k]).join('')+lfm.apiSecret);
}

async function lfmCall(params) {
  params.api_key = lfm.apiKey; params.format = 'json';
  if (lfm.sessionKey && !params.sk) params.sk = lfm.sessionKey;
  if (params.sk || params.method === 'auth.getMobileSession') params.api_sig = lfmSign(params);
  try {
    const res = await fetch(LASTFM_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    return await res.json();
  } catch(e) { return null; }
}

async function lfmAuthenticate(username, password) {
  if (!lfm.apiKey || !lfm.apiSecret) { showLfmStatus('Enter API Key and Secret first.', 'error'); return; }
  showLfmStatus('Authenticating…', 'pending');
  const res = await lfmCall({ method: 'auth.getMobileSession', username, password });
  if (res && res.session) {
    lfm.sessionKey = res.session.key; lfm.username = res.session.name; lfm.enabled = true;
    saveLfmState(); updateLfmUI(); showLfmStatus(`Connected as ${lfm.username} ✓`, 'ok');
  } else {
    showLfmStatus(res?.error ? `Error ${res.error}: ${res.message}` : 'Auth failed.', 'error');
  }
}

function lfmDisconnect() {
  lfm.sessionKey=''; lfm.username=''; lfm.enabled=false;
  saveLfmState(); updateLfmUI(); showLfmStatus('Disconnected.', '');
}

async function lfmUpdateNowPlaying(track) {
  if (!lfm.enabled || !lfm.sessionKey || !track) return;
  await lfmCall({ method: 'track.updateNowPlaying', track: track.name, artist: track.artist, album: track.album, duration: Math.round(track.duration) });
}

async function lfmScrobble(track, timestamp) {
  if (!lfm.enabled || !lfm.sessionKey || !track || track.duration < 30) return;
  const res = await lfmCall({
    method: 'track.scrobble',
    'track[0]': track.name, 'artist[0]': track.artist,
    'album[0]': track.album, 'timestamp[0]': Math.round(timestamp),
  });
  if (res && res.scrobbles) { showLfmScrobbleBadge(); flushPendingScrobbles(); }
  else { lfm.pendingScrobbles.push({ track, timestamp }); saveLfmState(); }
}

async function flushPendingScrobbles() {
  if (!lfm.pendingScrobbles.length) return;
  const batch = lfm.pendingScrobbles.splice(0, 10);
  const params = { method: 'track.scrobble' };
  batch.forEach((s,i) => { params[`track[${i}]`]=s.track.name; params[`artist[${i}]`]=s.track.artist; params[`timestamp[${i}]`]=Math.round(s.timestamp); });
  await lfmCall(params); saveLfmState();
}

function showLfmStatus(msg, type) {
  const el = document.getElementById('lfmStatus');
  if (el) { el.textContent = msg; el.className = 'lfm-status '+(type||''); }
}

function showLfmScrobbleBadge() {
  const badge = document.getElementById('lfmBadge');
  if (!badge) return;
  badge.classList.add('visible');
  clearTimeout(badge._t);
  badge._t = setTimeout(() => badge.classList.remove('visible'), 3000);
}

function updateLfmUI() {
  const connected = !!lfm.sessionKey;
  const cs = document.getElementById('lfmConnected');
  const ds = document.getElementById('lfmDisconnected');
  const ud = document.getElementById('lfmUserDisplay');
  if (cs) cs.style.display = connected ? '' : 'none';
  if (ds) ds.style.display = connected ? 'none' : '';
  if (ud) ud.textContent = lfm.username || '';
  const ki = document.getElementById('lfmApiKey');
  const si = document.getElementById('lfmApiSecret');
  if (ki) ki.value = lfm.apiKey || '';
  if (si) si.value = lfm.apiSecret || '';
  const badge = document.getElementById('lfmBadge');
  if (badge) badge.style.display = connected ? '' : 'none';
}

function lfmSaveCredentials() {
  lfm.apiKey = document.getElementById('lfmApiKey').value.trim();
  lfm.apiSecret = document.getElementById('lfmApiSecret').value.trim();
  saveLfmState(); showLfmStatus('Credentials saved.', 'ok');
}

function lfmLogin() {
  const user = document.getElementById('lfmUser').value.trim();
  const pass = document.getElementById('lfmPass').value.trim();
  if (!user || !pass) { showLfmStatus('Enter username and password.', 'error'); return; }
  lfmAuthenticate(user, pass);
}

/* ─── Utils ──────────────────────────────────────────── */
function formatTime(s) {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
}
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function musicSVG(size) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" width="${size}" height="${size}"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
}

updateVolumeUI();
updateLfmUI();
