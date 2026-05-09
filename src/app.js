/* ─── Aurora Player v1.2 — app.js ───────────────────── */
'use strict';

const audio = document.getElementById('audioEl');
audio.preload = 'none';

// ── State ─────────────────────────────────────────────
let tracks = [];          // full library
let filteredTracks = [];  // search-filtered view
let currentIndex = -1;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 0;       // 0=off 1=all 2=one
let isMuted = false;
let volume = 0.8;
let liked = new Set();
let lyricsVisible = true;
let lyricsOverlayOpen = false;
let syncedLyrics = [];
let plainLyrics = [];
let currentView = 'songs';
let activeLyricIdx = -1;

// ── Playlists ─────────────────────────────────────────
let playlists = {};       // { id: { name, trackIds[] } }
let currentPlaylistId = null;

// ── On Repeat tracking ────────────────────────────────
let listenLog = {};       // { trackKey: totalSecondsListened }
let lastOnRepeatSync = 0;
const ON_REPEAT_INTERVAL = 60 * 60 * 1000; // 1 hour
const ON_REPEAT_MIN_SECONDS = 180;          // 3 min to qualify
const ON_REPEAT_MAX = 25;

// ── Art cache — stores only ONE blob URL per track ────
const artCache = new Map(); // trackId → blobUrl

// ── Shared reusable canvas for colour sampling ────────
const _canvas = document.createElement('canvas');
_canvas.width = _canvas.height = 8;
const _ctx = _canvas.getContext('2d', { willReadFrequently: true });

audio.volume = volume;

/* ─── Last.fm ─────────────────────────────────────────*/
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
let lfm = {
  apiKey:'', apiSecret:'', sessionKey:'', username:'',
  enabled:false, scrobbled:false, scrobbleThreshold:0,
  pendingScrobbles:[],
};

/* ─── Config ──────────────────────────────────────────*/
let config = {
  musicFolder:'', volume:0.8, shuffle:false, repeat:0,
  lyricsVisible:true, accentColor:'#a78bfa',
  autoLyrics:true, blurLyrics:true, crossfade:false, eqPreset:'flat',
  lastfm:{}, playlists:{}, listenLog:{},
};

function saveLfmState() { saveConfig(); }

async function saveConfig() {
  config.volume = volume;
  config.shuffle = isShuffle;
  config.repeat = repeatMode;
  config.lyricsVisible = lyricsVisible;
  config.autoLyrics = document.getElementById('autoLyrics')?.checked ?? true;
  config.blurLyrics = document.getElementById('blurLyrics')?.checked ?? true;
  config.crossfade = document.getElementById('crossfade')?.checked ?? false;
  config.eqPreset = document.getElementById('eqPreset')?.value ?? 'flat';
  config.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  config.lastfm = { apiKey:lfm.apiKey, apiSecret:lfm.apiSecret, sessionKey:lfm.sessionKey, username:lfm.username, enabled:lfm.enabled, pendingScrobbles:lfm.pendingScrobbles };
  config.playlists = playlists;
  config.listenLog = listenLog;

  const json = JSON.stringify(config, null, 2);
  if (window.__TAURI__) {
    try {
      const dir = await TauriAPI.path.appConfigDir();
      await TauriAPI.fs.createDir(dir, { recursive:true }).catch(()=>{});
      await TauriAPI.fs.writeFile({ path: dir + 'config.json', contents: json });
    } catch { try { localStorage.setItem('aurora_config', json); } catch {} }
  } else {
    try { localStorage.setItem('aurora_config', json); } catch {}
  }
}

async function loadConfig() {
  let saved = null;
  if (window.__TAURI__) {
    try {
      const dir = await TauriAPI.path.appConfigDir();
      const text = await TauriAPI.fs.readTextFile(dir + 'config.json');
      saved = JSON.parse(text);
    } catch { try { saved = JSON.parse(localStorage.getItem('aurora_config') || 'null'); } catch {} }
  } else {
    try { saved = JSON.parse(localStorage.getItem('aurora_config') || 'null'); } catch {}
  }
  if (!saved) return;
  Object.assign(config, saved);

  volume = config.volume ?? 0.8;
  audio.volume = volume;
  isShuffle = config.shuffle ?? false;
  repeatMode = config.repeat ?? 0;
  lyricsVisible = config.lyricsVisible ?? true;
  playlists = config.playlists ?? {};
  listenLog = config.listenLog ?? {};
  if (config.lastfm) Object.assign(lfm, config.lastfm);

  requestAnimationFrame(() => {
    updateVolumeUI();
    document.getElementById('shuffleBtn')?.classList.toggle('active', isShuffle);
    document.getElementById('lyricsPanel')?.classList.toggle('hidden', !lyricsVisible);
    document.getElementById('lyricsToggleBtn')?.classList.toggle('active', lyricsVisible);
    const el = (id) => document.getElementById(id);
    if (el('autoLyrics')) el('autoLyrics').checked = config.autoLyrics ?? true;
    if (el('blurLyrics')) el('blurLyrics').checked = config.blurLyrics ?? true;
    if (el('crossfade'))  el('crossfade').checked  = config.crossfade ?? false;
    if (el('eqPreset'))   el('eqPreset').value      = config.eqPreset ?? 'flat';
    if (config.accentColor) applyAccent(config.accentColor);
    updateLfmUI();
    renderPlaylistNav();
    if (config.musicFolder && window.__TAURI__) loadFolderFromPath(config.musicFolder);
  });
}

/* ─── Folder / File loading ──────────────────────────*/
function selectFolder() {
  if (window.__TAURI__) {
    window.__TAURI__.dialog.open({ directory:true, multiple:false })
      .then(p => { if (p) loadFolderFromPath(p); })
      .catch(() => document.getElementById('folderInput').click());
  } else {
    document.getElementById('folderInput').click();
  }
}

// Called from file input (browser fallback)
function loadFolder(files) {
  // Free previous object URLs
  freeAllArt();
  const audioExts = /\.(mp3|flac|ogg|wav|m4a|aac|opus|wma)$/i;
  const lrcExts   = /\.lrc$/i;
  const lrcFiles  = {};
  const audioFiles = [];
  Array.from(files).forEach(f => {
    if (lrcExts.test(f.name))   lrcFiles[f.name.replace(/\.lrc$/i,'').toLowerCase()] = f;
    if (audioExts.test(f.name)) audioFiles.push(f);
  });
  tracks = audioFiles.map((f, i) => ({
    id:i, file:f, path:null,
    url: URL.createObjectURL(f),
    name: f.name.replace(/\.[^.]+$/,''),
    artist:'Unknown Artist', album:'Unknown Album',
    duration:0, artLoaded:false,
    lrcFile: lrcFiles[f.name.replace(/\.[^.]+$/,'').toLowerCase()] || null,
    lrcPath: null,
  }));
  filteredTracks = [...tracks];
  renderTrackList();
  renderQueue();
  updateFolderDisplay(tracks.length + ' tracks loaded');
  // Load metadata lazily — only visible rows first
  lazyLoadMeta();
}

async function loadFolderFromPath(dirPath) {
  freeAllArt();
  try {
    const entries = await TauriAPI.fs.readDir(dirPath, { recursive:false });
    const audioExts = /\.(mp3|flac|ogg|wav|m4a|aac|opus|wma)$/i;
    const lrcExts   = /\.lrc$/i;
    const lrcMap = {}, audioEntries = [];
    entries.forEach(e => {
      if (!e.name) return;
      if (lrcExts.test(e.name))   lrcMap[e.name.replace(/\.lrc$/i,'').toLowerCase()] = e.path;
      if (audioExts.test(e.name)) audioEntries.push(e);
    });
    tracks = audioEntries.map((e, i) => ({
      id:i, file:null, path:e.path,
      url: TauriAPI.tauri.convertFileSrc(e.path),
      name: e.name.replace(/\.[^.]+$/,''),
      artist:'Unknown Artist', album:'Unknown Album',
      duration:0, artLoaded:false,
      lrcFile:null,
      lrcPath: lrcMap[e.name.replace(/\.[^.]+$/,'').toLowerCase()] || null,
    }));
    filteredTracks = [...tracks];
    renderTrackList();
    renderQueue();
    updateFolderDisplay(dirPath);
    config.musicFolder = dirPath;
    saveConfig();
    lazyLoadMeta();
  } catch(e) { console.error('readDir failed:', e); }
}

function updateFolderDisplay(text) {
  const el = document.getElementById('folderPathDisplay');
  if (el) el.textContent = text;
}

/* ─── Lazy metadata loading ──────────────────────────*/
// Loads tags for visible tracks first, then queues the rest
// Uses a small batch size so the UI never freezes
const META_BATCH = 8;
let metaQueue = [];
let metaRunning = false;

function lazyLoadMeta() {
  metaQueue = [...tracks];
  if (!metaRunning) processMeta();
}

async function processMeta() {
  metaRunning = true;
  while (metaQueue.length) {
    const batch = metaQueue.splice(0, META_BATCH);
    await Promise.all(batch.map(t => loadMeta(t)));
    // Yield to browser between batches
    await new Promise(r => setTimeout(r, 50));
  }
  metaRunning = false;
}

async function loadMeta(track) {
  if (track.artLoaded) return;
  track.artLoaded = true;

  // Browser file picker — File object already in memory, safe to read tags from
  if (track.file && window.jsmediatags) {
    try {
      const tag = await readTagsFromFile(track.file);
      applyTags(track, tag);
    } catch {}
  } else if (track.url && window.jsmediatags) {
    // Tauri asset:// URL — fetch only first 512KB via Range header
    // This avoids Tauri's readBinaryFile which loads the whole file
    try {
      const res = await fetch(track.url, {
        headers: { Range: 'bytes=0-524287' }
      });
      if (res.ok || res.status === 206) {
        const buf = await res.arrayBuffer();
        const tag = await readTagsFromBlob(new Blob([buf]));
        applyTags(track, tag);
      }
    } catch {}
  }

  refreshTrackRow(track);
  refreshQueueItem(track.id);
  if (currentIndex === track.id) updatePlayerUI();
}

function applyTags(track, tag) {
  const t = tag.tags;
  if (t.title)  track.name   = t.title;
  if (t.artist) track.artist = t.artist;
  if (t.album)  track.album  = t.album;
  if (t.picture && !artCache.has(track.id)) {
    const blob = new Blob([new Uint8Array(t.picture.data)], { type: t.picture.format });
    artCache.set(track.id, URL.createObjectURL(blob));
  }
}

function readTagsFromFile(file) {
  return new Promise((resolve, reject) => {
    window.jsmediatags.read(file, { onSuccess: resolve, onError: reject });
  });
}

function readTagsFromBlob(blob) {
  return new Promise((resolve, reject) => {
    window.jsmediatags.read(blob, { onSuccess: resolve, onError: reject });
  });
}

// Free all blob URLs when a new folder is loaded
function freeAllArt() {
  artCache.forEach(url => URL.revokeObjectURL(url));
  artCache.clear();
  // Also free track object URLs from file-picker mode
  tracks.forEach(t => { if (t.url && t.url.startsWith('blob:')) URL.revokeObjectURL(t.url); });
}

function getArt(trackId) { return artCache.get(trackId) || null; }

/* ─── Rendering ──────────────────────────────────────*/
function renderTrackList(list = filteredTracks, containerId = 'trackList', showPlaytime = false) {
  const el = document.getElementById(containerId);
  if (!list.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${musicSVG(64)}</div><p>No tracks here yet</p></div>`;
    return;
  }
  el.innerHTML = list.map((t, i) => {
    const art = getArt(t.id);
    const col3 = showPlaytime
      ? `<div class="track-artist">${formatTime(listenLog[trackKey(t)] || 0)}</div>`
      : `<div class="track-artist">${esc(t.artist)}</div>`;
    return `
    <div class="track-row${currentIndex===t.id?' active':''}" data-id="${t.id}" onclick="playTrack(${t.id})" oncontextmenu="showContextMenu(event,${t.id})" style="animation-delay:${Math.min(i*0.015,0.4)}s">
      <div class="track-num">${currentIndex===t.id&&isPlaying?'▶':i+1}</div>
      <div class="track-info">
        <div class="track-thumb">${art?`<img src="${art}" alt="" loading="lazy">`:musicSVG(14)}</div>
        <div class="track-titles"><div class="track-title">${esc(t.name)}</div></div>
      </div>
      ${col3}
      <div class="track-album">${esc(t.album)}</div>
      <div class="track-dur">${formatTime(t.duration)}</div>
    </div>`;
  }).join('');
}

function refreshTrackRow(track) {
  const row = document.querySelector(`.track-row[data-id="${track.id}"]`);
  if (!row) return;
  row.querySelector('.track-title').textContent = track.name;
  const artistEl = row.querySelector('.track-artist');
  if (artistEl && !artistEl.dataset.playtime) artistEl.textContent = track.artist;
  row.querySelector('.track-album').textContent = track.album;
  row.querySelector('.track-dur').textContent = formatTime(track.duration);
  const thumb = row.querySelector('.track-thumb');
  const art = getArt(track.id);
  if (art) thumb.innerHTML = `<img src="${art}" alt="" loading="lazy">`;
}

function renderQueue() {
  const list = document.getElementById('queueList');
  if (!tracks.length) { list.innerHTML = '<div class="queue-empty">No tracks loaded</div>'; return; }
  list.innerHTML = tracks.map((t, i) => `
    <div class="queue-item${currentIndex===t.id?' active':''}" data-qid="${t.id}" draggable="true" onclick="playTrack(${t.id})" oncontextmenu="showQueueContextMenu(event,${t.id})">
      <span class="qi-drag" onclick="event.stopPropagation()">⠿</span>
      <span class="qi-num">${i+1}</span>
      <div class="qi-info">
        <div class="qi-title">${esc(t.name)}</div>
        <div class="qi-artist">${esc(t.artist)}</div>
      </div>
    </div>`).join('');
  initQueueDrag();
}

function initQueueDrag() {
  const list = document.getElementById('queueList');
  let dragSrc = null;

  list.querySelectorAll('.queue-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      dragSrc = item;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => item.classList.add('dragging'), 0);
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      list.querySelectorAll('.queue-item').forEach(i => i.classList.remove('drag-over'));
      dragSrc = null;
    });
    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (item === dragSrc) return;
      list.querySelectorAll('.queue-item').forEach(i => i.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    item.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragSrc || dragSrc === item) return;
      const srcId = parseInt(dragSrc.dataset.qid);
      const tgtId = parseInt(item.dataset.qid);
      const srcIdx = tracks.findIndex(t => t.id === srcId);
      const tgtIdx = tracks.findIndex(t => t.id === tgtId);
      if (srcIdx < 0 || tgtIdx < 0) return;
      const [moved] = tracks.splice(srcIdx, 1);
      tracks.splice(tgtIdx, 0, moved);
      filteredTracks = [...tracks];
      renderQueue();
      renderTrackList();
    });
  });
}

function refreshQueueItem(id) {
  const el = document.querySelector(`.queue-item[data-qid="${id}"]`);
  if (!el) return;
  const t = tracks.find(t => t.id === id);
  if (!t) return;
  el.querySelector('.qi-title').textContent = t.name;
  el.querySelector('.qi-artist').textContent = t.artist;
}

function renderAlbums() {
  const albums = {};
  tracks.forEach(t => {
    if (!albums[t.album]) albums[t.album] = { name:t.album, count:0, art:null, trackIds:[] };
    albums[t.album].count++;
    albums[t.album].trackIds.push(t.id);
    if (!albums[t.album].art) albums[t.album].art = getArt(t.id);
  });
  document.getElementById('albumsGrid').innerHTML = Object.values(albums).map(a => `
    <div class="album-card" onclick="playAlbum(${JSON.stringify(a.trackIds)})">
      <div class="album-art">${a.art?`<img src="${a.art}" alt="" loading="lazy">`:musicSVG(48)}</div>
      <div class="album-name">${esc(a.name)}</div>
      <div class="album-count">${a.count} track${a.count!==1?'s':''}</div>
    </div>`).join('');
}

function renderArtists() {
  const artists = {};
  tracks.forEach(t => {
    if (!artists[t.artist]) artists[t.artist] = { name:t.artist, count:0, art:null };
    artists[t.artist].count++;
    if (!artists[t.artist].art) artists[t.artist].art = getArt(t.id);
  });
  document.getElementById('artistsGrid').innerHTML = Object.values(artists).map(a => `
    <div class="album-card">
      <div class="album-art" style="border-radius:50%">${a.art?`<img src="${a.art}" alt="" loading="lazy" style="border-radius:50%">`:musicSVG(48)}</div>
      <div class="album-name">${esc(a.name)}</div>
      <div class="album-count">${a.count} track${a.count!==1?'s':''}</div>
    </div>`).join('');
}

function playAlbum(ids) { if (ids.length) playTrack(ids[0]); }

/* ─── Playlists ──────────────────────────────────────*/
function renderPlaylistNav() {
  const nav = document.getElementById('playlistNav');
  if (!nav) return;
  nav.innerHTML = Object.entries(playlists).map(([id, pl]) => `
    <button class="nav-item${currentView==='playlist-'+id?' active':''}" onclick="openPlaylist('${id}', this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      ${esc(pl.name)}
    </button>`).join('');
}

function openCreatePlaylist() {
  document.getElementById('playlistNameInput').value = '';
  document.getElementById('playlistModal').classList.add('open');
  setTimeout(() => document.getElementById('playlistNameInput').focus(), 100);
}

function closePlaylistModal(e) {
  if (!e || e.target === document.getElementById('playlistModal'))
    document.getElementById('playlistModal').classList.remove('open');
}

function confirmCreatePlaylist() {
  const name = document.getElementById('playlistNameInput').value.trim();
  if (!name) return;
  const id = 'pl_' + Date.now();
  playlists[id] = { name, trackIds:[] };
  renderPlaylistNav();
  saveConfig();
  closePlaylistModal();
  openPlaylist(id);
}

function openPlaylist(id, btn) {
  currentPlaylistId = id;
  const pl = playlists[id];
  if (!pl) return;
  renderPlaylistTitle(id);
  const plTracks = pl.trackIds.map(tid => tracks.find(t => t.id === tid)).filter(Boolean);
  setView('playlist-custom', btn);
  renderTrackList(plTracks, 'customPlaylistTracks');
  filteredTracks = plTracks;
  renderQueue();
}

function renderPlaylistTitle(id) {
  const pl = playlists[id];
  if (!pl) return;
  const el = document.getElementById('customPlaylistTitle');
  el.innerHTML = `
    <div class="playlist-title-wrap">
      <span id="plTitleText">${esc(pl.name)}</span>
      <button class="rename-btn" onclick="startRenamePlaylist('${id}')" title="Rename">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
    </div>`;
}

function startRenamePlaylist(id) {
  const pl = playlists[id];
  if (!pl) return;
  const el = document.getElementById('customPlaylistTitle');
  el.innerHTML = `
    <div class="playlist-title-wrap">
      <input class="rename-input" id="renameInput" value="${esc(pl.name)}" maxlength="60" />
      <button class="rename-btn" onclick="confirmRenamePlaylist('${id}')" title="Save">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    </div>`;
  const inp = document.getElementById('renameInput');
  inp.focus(); inp.select();
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmRenamePlaylist(id);
    if (e.key === 'Escape') renderPlaylistTitle(id);
  });
}

function confirmRenamePlaylist(id) {
  const inp = document.getElementById('renameInput');
  if (!inp) return;
  const name = inp.value.trim();
  if (!name) return;
  playlists[id].name = name;
  saveConfig();
  renderPlaylistNav();
  renderPlaylistTitle(id);
}

/* ─── Add Songs Modal ────────────────────────────────*/
function openAddSongsModal() {
  if (!currentPlaylistId) return;
  document.getElementById('addSongsSearch').value = '';
  renderAddSongsList(tracks);
  document.getElementById('addSongsModal').style.display = 'flex';
  setTimeout(() => document.getElementById('addSongsSearch').focus(), 100);
}

function closeAddSongsModal(e) {
  if (!e || e.target === document.getElementById('addSongsModal'))
    document.getElementById('addSongsModal').style.display = 'none';
}

function filterAddSongs(query) {
  const q = query.toLowerCase();
  const filtered = q ? tracks.filter(t =>
    t.name.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
  ) : tracks;
  renderAddSongsList(filtered);
}

function renderAddSongsList(list) {
  const pl = playlists[currentPlaylistId];
  const container = document.getElementById('addSongsList');
  if (!list.length) { container.innerHTML = '<div style="padding:12px 12px;color:var(--text3);font-size:13px">No songs found</div>'; return; }
  container.innerHTML = list.map(t => {
    const added = pl && pl.trackIds.includes(t.id);
    return `<div class="add-song-row" onclick="toggleSongInPlaylist(${t.id}, this)">
      <div style="flex:1;overflow:hidden">
        <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text1)">${esc(t.name)}</div>
        <div style="font-size:11px;color:var(--text3)">${esc(t.artist)}</div>
      </div>
      <div class="add-song-check${added ? ' added' : ''}" data-id="${t.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
    </div>`;
  }).join('');
}

function toggleSongInPlaylist(trackId, row) {
  if (!currentPlaylistId) return;
  const pl = playlists[currentPlaylistId];
  const check = row.querySelector('.add-song-check');
  const idx = pl.trackIds.indexOf(trackId);
  if (idx === -1) {
    pl.trackIds.push(trackId);
    check.classList.add('added');
  } else {
    pl.trackIds.splice(idx, 1);
    check.classList.remove('added');
  }
  saveConfig();
  // Refresh playlist view in background
  const plTracks = pl.trackIds.map(tid => tracks.find(t => t.id === tid)).filter(Boolean);
  renderTrackList(plTracks, 'customPlaylistTracks');
}

function deleteCurrentPlaylist() {
  if (!currentPlaylistId) return;
  delete playlists[currentPlaylistId];
  currentPlaylistId = null;
  renderPlaylistNav();
  saveConfig();
  setView('songs', document.querySelector('.nav-item'));
}

function addToPlaylist(trackId, playlistId) {
  if (!playlists[playlistId]) return;
  if (!playlists[playlistId].trackIds.includes(trackId))
    playlists[playlistId].trackIds.push(trackId);
  saveConfig();
}

/* ─── On Repeat ──────────────────────────────────────*/
function trackKey(t) { return `${t.name}|||${t.artist}`; }

function recordListenTime(seconds) {
  const t = tracks.find(t => t.id === currentIndex);
  if (!t || seconds < 1) return;
  const key = trackKey(t);
  listenLog[key] = (listenLog[key] || 0) + seconds;
  // Auto sync every hour
  const now = Date.now();
  if (now - lastOnRepeatSync > ON_REPEAT_INTERVAL) {
    lastOnRepeatSync = now;
    saveConfig();
    if (currentView === 'playlist-onrepeat') renderOnRepeat();
  }
}

function renderOnRepeat() {
  const el = document.getElementById('onRepeatList');
  if (!el) return;

  // Sort by listen time, top 25
  const sorted = Object.entries(listenLog)
    .filter(([,s]) => s >= ON_REPEAT_MIN_SECONDS)
    .sort(([,a],[,b]) => b - a)
    .slice(0, ON_REPEAT_MAX);

  if (!sorted.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${musicSVG(48)}</div><p>Keep listening — tracks you play the most will appear here</p></div>`;
    document.getElementById('onRepeatBadge').textContent = '';
    return;
  }

  document.getElementById('onRepeatBadge').textContent = sorted.length;

  // Match keys to track objects
  const list = sorted.map(([key, secs]) => {
    const t = tracks.find(t => trackKey(t) === key);
    return t ? { track:t, secs } : null;
  }).filter(Boolean);

  el.innerHTML = list.map(({ track:t, secs }, i) => {
    const art = getArt(t.id);
    return `
    <div class="track-row${currentIndex===t.id?' active':''}" data-id="${t.id}" onclick="playTrack(${t.id})" style="animation-delay:${i*0.02}s">
      <div class="track-num">${i+1}</div>
      <div class="track-info">
        <div class="track-thumb">${art?`<img src="${art}" alt="" loading="lazy">`:musicSVG(14)}</div>
        <div class="track-titles"><div class="track-title">${esc(t.name)}</div></div>
      </div>
      <div class="track-artist">${esc(t.artist)}</div>
      <div class="track-album" style="color:var(--accent)">${formatListenTime(secs)}</div>
      <div class="track-dur">${formatTime(t.duration)}</div>
    </div>`;
  }).join('');

  const status = document.getElementById('onRepeatSyncStatus');
  if (status) status.textContent = `Last synced ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
}

function formatListenTime(secs) {
  if (secs >= 3600) return `${(secs/3600).toFixed(1)}h played`;
  if (secs >= 60)   return `${Math.floor(secs/60)}m played`;
  return `${secs}s played`;
}

/* ─── Playback ───────────────────────────────────────*/
let listenStart = 0;

function playTrack(id) {
  // Record listen time for previous track
  if (currentIndex >= 0 && listenStart > 0)
    recordListenTime(Math.floor((Date.now() - listenStart) / 1000));

  const track = tracks.find(t => t.id === id);
  if (!track) return;
  currentIndex = id;
  audio.src = track.url;
  audio.play();
  isPlaying = true;
  listenStart = Date.now();
  updatePlayerUI(); updateActiveRows(); renderQueue();
  loadLyrics(track); updateAmbient(track.id);
  // Last.fm
  lfm.scrobbled = false;
  lfm.scrobbleThreshold = Math.min(track.duration / 2, 240);
  if (lfm.enabled) lfmUpdateNowPlaying(track);
}

function togglePlay() {
  if (!audio.src) return;
  if (isPlaying) {
    audio.pause();
    recordListenTime(Math.floor((Date.now() - listenStart) / 1000));
    listenStart = 0;
  } else {
    audio.play();
    listenStart = Date.now();
  }
}

function playNext() {
  if (!filteredTracks.length) return;
  if (repeatMode === 2) { audio.currentTime = 0; audio.play(); return; }
  const idx = filteredTracks.findIndex(t => t.id === currentIndex);
  const next = isShuffle ? Math.floor(Math.random()*filteredTracks.length) : (idx+1) % filteredTracks.length;
  playTrack(filteredTracks[next].id);
}

function playPrev() {
  if (!filteredTracks.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const idx = filteredTracks.findIndex(t => t.id === currentIndex);
  playTrack(filteredTracks[(idx-1+filteredTracks.length)%filteredTracks.length].id);
}

function toggleShuffle() {
  isShuffle = !isShuffle;
  document.getElementById('shuffleBtn').classList.toggle('active', isShuffle);
  saveConfig();
}

function cycleRepeat() {
  repeatMode = (repeatMode+1) % 3;
  const btn = document.getElementById('repeatBtn');
  btn.classList.toggle('active', repeatMode > 0);
  btn.title = ['Repeat Off','Repeat All','Repeat One'][repeatMode];
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>${repeatMode===2?'<text x="12" y="14.5" text-anchor="middle" font-size="7" fill="currentColor" stroke="none">1</text>':''}</svg>`;
  saveConfig();
}

function seekTo(e) {
  const bar = document.getElementById('progressBar');
  const r = bar.getBoundingClientRect();
  audio.currentTime = Math.max(0, Math.min(1, (e.clientX-r.left)/r.width)) * audio.duration;
}

function setVolume(e) {
  const bar = document.getElementById('volumeBar');
  const r = bar.getBoundingClientRect();
  volume = Math.max(0, Math.min(1, (e.clientX-r.left)/r.width));
  audio.volume = volume; isMuted = false; updateVolumeUI(); saveConfig();
}

function toggleMute() { isMuted = !isMuted; audio.muted = isMuted; updateVolumeUI(); }

function toggleLike() {
  if (currentIndex < 0) return;
  liked.has(currentIndex) ? liked.delete(currentIndex) : liked.add(currentIndex);
  document.getElementById('heartBtn').classList.toggle('liked', liked.has(currentIndex));
}

/* ─── UI Updates ─────────────────────────────────────*/
function updatePlayerUI() {
  const track = tracks.find(t => t.id === currentIndex);
  if (!track) return;
  document.getElementById('playerTrackName').textContent   = track.name;
  document.getElementById('playerTrackArtist').textContent = track.artist;
  document.getElementById('heartBtn').classList.toggle('liked', liked.has(currentIndex));
  const art = getArt(currentIndex);
  const artEl = document.getElementById('playerArt');
  artEl.innerHTML = art
    ? `<img src="${art}" alt=""><div class="vinyl-hole"></div>`
    : `<div class="art-placeholder">${musicSVG(28)}</div><div class="vinyl-hole"></div>`;
  // Overlay
  const overlayArt = document.getElementById('overlayArt');
  if (overlayArt) overlayArt.innerHTML = art ? `<img src="${art}" alt="">` : musicSVG(80);
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayArtist = document.getElementById('overlayArtist');
  if (overlayTitle)  overlayTitle.textContent  = track.name;
  if (overlayArtist) overlayArtist.textContent = track.artist;
  updatePlayBtn(); updateSpinning();
}

function updatePlayBtn() {
  document.querySelector('.play-icon').style.display  = isPlaying ? 'none' : '';
  document.querySelector('.pause-icon').style.display = isPlaying ? '' : 'none';
}

function updateSpinning() {
  document.getElementById('playerArt').classList.toggle('playing', isPlaying);
}

function updateActiveRows() {
  document.querySelectorAll('.track-row').forEach(r => {
    const active = parseInt(r.dataset.id) === currentIndex;
    r.classList.toggle('active', active);
    const numEl = r.querySelector('.track-num');
    if (numEl) numEl.textContent = active ? '▶' : (filteredTracks.findIndex(t=>t.id===parseInt(r.dataset.id))+1 || '');
  });
  document.querySelectorAll('.queue-item').forEach((r, i) => {
    r.classList.toggle('active', tracks[i]?.id === currentIndex);
  });
}

function updateVolumeUI() {
  const pct = isMuted ? 0 : volume * 100;
  document.getElementById('volumeFill').style.width  = pct + '%';
  document.getElementById('volumeThumb').style.left  = pct + '%';
}

function updateAmbient(trackId) {
  const art = getArt(trackId);
  const bg  = document.getElementById('ambientBg');
  if (!art) {
    bg.style.background = 'radial-gradient(ellipse 60% 50% at 50% -10%, rgba(167,139,250,0.12), transparent 70%)';
    return;
  }
  const img = new Image();
  img.onload = () => {
    try {
      _ctx.drawImage(img, 0, 0, 8, 8);
      const d = _ctx.getImageData(0, 0, 8, 8).data;
      let r=0,g=0,b=0;
      for (let i=0; i<d.length; i+=4) { r+=d[i]; g+=d[i+1]; b+=d[i+2]; }
      const n = d.length/4;
      const col = `rgba(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)},0.18)`;
      bg.style.background = `radial-gradient(ellipse 60% 50% at 50% -10%, ${col}, transparent 70%)`;
      applyAccent(rgbToHex(Math.round(r/n), Math.round(g/n), Math.round(b/n)));
    } catch {}
  };
  img.src = art;
}

function applyAccent(color) {
  document.documentElement.style.setProperty('--accent', color);
  const r=parseInt(color.slice(1,3),16), g=parseInt(color.slice(3,5),16), b=parseInt(color.slice(5,7),16);
  document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.15)`);
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', s.dataset.color===color));
}

function rgbToHex(r,g,b) { return '#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join(''); }

/* ─── Audio events ───────────────────────────────────*/
audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressThumb').style.left = pct + '%';
  document.getElementById('currentTime').textContent  = formatTime(audio.currentTime);
  document.getElementById('totalTime').textContent    = formatTime(audio.duration);
  syncLyricLine(audio.currentTime);
  // Scrobble
  if (lfm.enabled && !lfm.scrobbled && lfm.scrobbleThreshold>0 && audio.currentTime>=lfm.scrobbleThreshold) {
    lfm.scrobbled = true;
    const t = tracks.find(t=>t.id===currentIndex);
    if (t) lfmScrobble(t, Math.floor(Date.now()/1000) - Math.floor(audio.currentTime));
  }
});
audio.addEventListener('ended', () => {
  recordListenTime(Math.floor((Date.now()-listenStart)/1000));
  listenStart = 0;
  if (repeatMode===2) { audio.play(); return; }
  playNext();
});
audio.addEventListener('play',  () => { isPlaying=true;  updatePlayBtn(); updateSpinning(); updateActiveRows(); });
audio.addEventListener('pause', () => { isPlaying=false; updatePlayBtn(); updateSpinning(); });

/* ─── Lyrics ─────────────────────────────────────────*/
async function loadLyrics(track) {
  syncedLyrics=[]; plainLyrics=[]; activeLyricIdx=-1;
  const content = document.getElementById('lyricsContent');
  const src     = document.getElementById('lyricsSource');
  const osrc    = document.getElementById('lyricsSourceOverlay');
  content.innerHTML = `<div class="lyrics-idle">${musicSVG(32)}<p>Loading lyrics…</p></div>`;
  if (src)  src.textContent  = '';
  if (osrc) osrc.textContent = '';
  syncOverlayLyrics();

  if (track.lrcFile) {
    const text = await readFileAsText(track.lrcFile);
    return finishLyrics(text, null, 'Local .lrc', src, osrc);
  }
  if (track.lrcPath && window.__TAURI__) {
    try {
      const text = await TauriAPI.fs.readTextFile(track.lrcPath);
      return finishLyrics(text, null, 'Local .lrc', src, osrc);
    } catch {}
  }
  if (!document.getElementById('autoLyrics').checked) {
    content.innerHTML = `<div class="no-lyrics"><p>No lyrics found</p></div>`; return;
  }

  try {
    const result = await Promise.any([
      fetchFromNetEase(track.name, track.artist !== 'Unknown Artist' ? track.artist : ''),
      fetchFromMusixmatch(track.name, track.artist !== 'Unknown Artist' ? track.artist : ''),
      fetchFromLrclib(track.name, track.artist !== 'Unknown Artist' ? track.artist : ''),
    ].map(p => p.catch(() => Promise.reject('failed'))));

    if (result.synced) finishLyrics(result.synced, null, result.source+' · synced', src, osrc);
    else if (result.plain) finishLyrics(null, result.plain, result.source, src, osrc);
    else content.innerHTML = `<div class="no-lyrics"><p>No lyrics found</p></div>`;
  } catch {
    content.innerHTML = `<div class="no-lyrics"><p>No lyrics found</p></div>`;
  }
}

function finishLyrics(lrcText, plainText, label, srcEl, osrcEl) {
  if (lrcText) { parseLRC(lrcText); renderLyricLines(); }
  else if (plainText) { plainLyrics = plainText.split('\n').filter(l=>l.trim()); renderPlainLyrics(); }
  if (srcEl)  srcEl.textContent  = label;
  if (osrcEl) osrcEl.textContent = label;
  syncOverlayLyrics();
}

async function fetchFromNetEase(title, artist) {
  const q   = encodeURIComponent(`${title} ${artist}`.trim());
  const res = await fetchWithTimeout(`https://netease-cloud-music-api-taupe-phi.vercel.app/search?keywords=${q}&limit=1`, 4000);
  if (!res.ok) throw new Error();
  const song = (await res.json())?.result?.songs?.[0];
  if (!song) throw new Error();
  const lr  = await fetchWithTimeout(`https://netease-cloud-music-api-taupe-phi.vercel.app/lyric?id=${song.id}`, 4000);
  if (!lr.ok) throw new Error();
  const lrc = (await lr.json())?.lrc?.lyric;
  if (!lrc || lrc.includes('纯音乐') || lrc.trim().length<10) throw new Error();
  return { synced:lrc, source:'NetEase' };
}

async function fetchFromMusixmatch(title, artist) {
  const res = await fetchWithTimeout(
    `https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&namespace=lyrics_synched&subtitle_format=mxm&app_id=web-desktop-app-v1.0&usertoken=190523f77464fba06fa5f82a9bfab0571dac14793a5b43571c3f8f5&q_track=${encodeURIComponent(title)}&q_artist=${encodeURIComponent(artist)}&page_size=1`, 4000);
  if (!res.ok) throw new Error();
  const body = (await res.json())?.message?.body?.macro_calls;
  const sub  = body?.['track.subtitles.get']?.message?.body?.subtitle_list?.[0]?.subtitle;
  if (!sub?.subtitle_body) throw new Error();
  const lines = JSON.parse(sub.subtitle_body);
  const lrc = lines.map(l => {
    const t = l.time;
    return `[${String(Math.floor(t.minutes)).padStart(2,'0')}:${String(Math.floor(t.seconds)).padStart(2,'0')}.${String(Math.floor(t.hundredths||0)).padStart(2,'00')}]${l.text}`;
  }).join('\n');
  return { synced:lrc, source:'Musixmatch' };
}

async function fetchFromLrclib(title, artist) {
  const q   = encodeURIComponent(`${artist} ${title}`.trim());
  const res = await fetchWithTimeout(`https://lrclib.net/api/search?q=${q}`, 6000);
  if (!res.ok) throw new Error();
  const best = (await res.json())?.[0];
  if (!best) throw new Error();
  if (best.syncedLyrics) return { synced:best.syncedLyrics, source:'lrclib' };
  if (best.plainLyrics)  return { plain:best.plainLyrics,  source:'lrclib' };
  throw new Error();
}

function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const id   = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal:ctrl.signal }).finally(() => clearTimeout(id));
}

function readFileAsText(file) {
  return new Promise((res,rej) => { const r=new FileReader(); r.onload=e=>res(e.target.result); r.onerror=rej; r.readAsText(file); });
}

function parseLRC(text) {
  syncedLyrics = [];
  text.split('\n').forEach(line => {
    const m = line.match(/\[(\d+):(\d+)[.:](\d+)\](.*)/);
    if (m) {
      const time = parseInt(m[1])*60 + parseFloat(m[2]+'.'+m[3]);
      const txt  = m[4].trim();
      if (txt) syncedLyrics.push({ time, text:txt });
    }
  });
  syncedLyrics.sort((a,b)=>a.time-b.time);
}

function renderLyricLines() {
  const html = syncedLyrics.length
    ? syncedLyrics.map((l,i) => `<div class="lyric-line" data-idx="${i}" data-time="${l.time}" onclick="seekToLyric(${l.time})">${esc(l.text)}</div>`).join('')
    : `<div class="no-lyrics"><p>No lyrics found</p></div>`;
  document.getElementById('lyricsContent').innerHTML = html;
  syncOverlayLyrics();
}

function renderPlainLyrics() {
  const html = plainLyrics.map(l=>`<div class="lyric-line near">${esc(l)}</div>`).join('');
  document.getElementById('lyricsContent').innerHTML = html;
  syncOverlayLyrics();
}

function syncLyricLine(currentTime) {
  if (!syncedLyrics.length) return;
  let idx = -1;
  for (let i=0; i<syncedLyrics.length; i++) {
    if (syncedLyrics[i].time <= currentTime + 0.3) idx = i;
    else break;
  }
  if (idx === activeLyricIdx) return; // no change
  activeLyricIdx = idx;
  if (idx < 0) return;

  const blur = document.getElementById('blurLyrics').checked;

  // Sidebar lyrics
  const lines = document.querySelectorAll('#lyricsContent .lyric-line');
  lines.forEach((el,i) => {
    el.classList.remove('active','blur','near');
    if (i===idx) { el.classList.add('active'); el.scrollIntoView({behavior:'smooth',block:'center'}); }
    else if (blur) el.classList.add(Math.abs(i-idx)===1?'near':'blur');
    else if (Math.abs(i-idx)<=2) el.classList.add('near');
  });

  // Overlay lyrics
  const olines = document.querySelectorAll('#lyricsOverlayContent .lyric-line');
  olines.forEach((el,i) => {
    el.classList.remove('active','blur','near');
    if (i===idx) { el.classList.add('active'); el.scrollIntoView({behavior:'smooth',block:'center'}); }
    else if (blur) el.classList.add(Math.abs(i-idx)===1?'near':'blur');
    else if (Math.abs(i-idx)<=2) el.classList.add('near');
  });
}

function syncOverlayLyrics() {
  const oc = document.getElementById('lyricsOverlayContent');
  if (!oc) return;
  oc.innerHTML = document.getElementById('lyricsContent').innerHTML;
  // Re-bind onclick for overlay lines (they need to seek too)
  oc.querySelectorAll('.lyric-line[data-time]').forEach(el => {
    el.onclick = () => seekToLyric(parseFloat(el.dataset.time));
  });
}

function seekToLyric(time) { audio.currentTime=time; if (!isPlaying) audio.play(); }

/* ─── Lyrics Overlay ─────────────────────────────────*/
function toggleLyricsOverlay() {
  lyricsOverlayOpen = !lyricsOverlayOpen;
  const overlay = document.getElementById('lyricsOverlay');
  overlay.classList.toggle('open', lyricsOverlayOpen);
  if (lyricsOverlayOpen) syncOverlayLyrics();
}

function closeLyricsOverlay(e) {
  if (e.target === document.getElementById('lyricsOverlay')) toggleLyricsOverlay();
}

/* ─── Filter / Search ────────────────────────────────*/
function filterTracks(q) {
  const ql = q.toLowerCase();
  filteredTracks = ql ? tracks.filter(t =>
    t.name.toLowerCase().includes(ql) || t.artist.toLowerCase().includes(ql) || t.album.toLowerCase().includes(ql)
  ) : [...tracks];
  renderTrackList();
}

/* ─── View switching ─────────────────────────────────*/
function setView(name, btn) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(`view-${name}`);
  if (view) view.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (name==='albums') renderAlbums();
  if (name==='artists') renderArtists();
  if (name==='playlist-onrepeat') renderOnRepeat();
  if (name==='songs' || name==='albums' || name==='artists') {
    filteredTracks = [...tracks];
    renderQueue();
  }
}

/* ─── Settings ───────────────────────────────────────*/
function toggleSettings() { document.getElementById('settingsOverlay').classList.toggle('open'); }
function closeSettings(e) { if (e.target===document.getElementById('settingsOverlay')) toggleSettings(); }

function setAccent(btn) {
  applyAccent(btn.dataset.color);
  saveConfig();
}

/* ─── Lyrics Panel ───────────────────────────────────*/
function toggleLyricsPanel() {
  lyricsVisible = !lyricsVisible;
  document.getElementById('lyricsPanel').classList.toggle('hidden', !lyricsVisible);
  document.getElementById('lyricsToggleBtn').classList.toggle('active', lyricsVisible);
  saveConfig();
}

/* ─── Window Controls ────────────────────────────────*/
async function handleClose()    { if (window.__TAURI__) await TauriAPI.window.appWindow.close(); }
async function handleMinimize() { if (window.__TAURI__) await TauriAPI.window.appWindow.minimize(); }
async function handleMaximize() { if (window.__TAURI__) await TauriAPI.window.appWindow.toggleMaximize(); }

/* ─── Keyboard Shortcuts ─────────────────────────────*/
document.addEventListener('keydown', e => {
  if (e.target.tagName==='INPUT' || e.target.tagName==='SELECT') return;
  switch(e.code) {
    case 'Space':       e.preventDefault(); togglePlay(); break;
    case 'ArrowRight':  if (e.metaKey||e.ctrlKey) playNext(); break;
    case 'ArrowLeft':   if (e.metaKey||e.ctrlKey) playPrev(); break;
    case 'ArrowUp':     volume=Math.min(1,volume+0.05); audio.volume=volume; updateVolumeUI(); break;
    case 'ArrowDown':   volume=Math.max(0,volume-0.05); audio.volume=volume; updateVolumeUI(); break;
    case 'KeyL':        toggleLyricsPanel(); break;
    case 'KeyS':        toggleShuffle(); break;
    case 'KeyF':        toggleLyricsOverlay(); break;
    case 'F5':          e.preventDefault(); break; // disable refresh
    case 'KeyR':        cycleRepeat(); break;
    case 'KeyM':        toggleMute(); break;
  }
});

// Also block F5 via beforeunload for older WebViews
window.addEventListener('beforeunload', e => { if (isPlaying) e.preventDefault(); });

/* ─── Last.fm ────────────────────────────────────────*/
function md5(str) {
  function safeAdd(x,y){const l=(x&0xffff)+(y&0xffff);return(((x>>16)+(y>>16)+(l>>16))<<16)|(l&0xffff);}
  function rol(n,c){return(n<<c)|(n>>>(32-c));}
  function cmn(q,a,b,x,s,t){return safeAdd(rol(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b);}
  function ff(a,b,c,d,x,s,t){return cmn((b&c)|((~b)&d),a,b,x,s,t);}
  function gg(a,b,c,d,x,s,t){return cmn((b&d)|(c&(~d)),a,b,x,s,t);}
  function hh(a,b,c,d,x,s,t){return cmn(b^c^d,a,b,x,s,t);}
  function ii(a,b,c,d,x,s,t){return cmn(c^(b|(~d)),a,b,x,s,t);}
  function blks(s){const n=((s.length+8)>>6)+1,b=new Array(n*16).fill(0);for(let i=0;i<s.length;i++)b[i>>2]|=s.charCodeAt(i)<<((i%4)*8);b[s.length>>2]|=0x80<<((s.length%4)*8);b[n*16-2]=s.length*8;return b;}
  const x=blks(str);let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
  for(let i=0;i<x.length;i+=16){const[A,B,C,D]=[a,b,c,d];a=ff(a,b,c,d,x[i],7,-680876936);d=ff(d,a,b,c,x[i+1],12,-389564586);c=ff(c,d,a,b,x[i+2],17,606105819);b=ff(b,c,d,a,x[i+3],22,-1044525330);a=ff(a,b,c,d,x[i+4],7,-176418897);d=ff(d,a,b,c,x[i+5],12,1200080426);c=ff(c,d,a,b,x[i+6],17,-1473231341);b=ff(b,c,d,a,x[i+7],22,-45705983);a=ff(a,b,c,d,x[i+8],7,1770035416);d=ff(d,a,b,c,x[i+9],12,-1958414417);c=ff(c,d,a,b,x[i+10],17,-42063);b=ff(b,c,d,a,x[i+11],22,-1990404162);a=ff(a,b,c,d,x[i+12],7,1804603682);d=ff(d,a,b,c,x[i+13],12,-40341101);c=ff(c,d,a,b,x[i+14],17,-1502002290);b=ff(b,c,d,a,x[i+15],22,1236535329);a=gg(a,b,c,d,x[i+1],5,-165796510);d=gg(d,a,b,c,x[i+6],9,-1069501632);c=gg(c,d,a,b,x[i+11],14,643717713);b=gg(b,c,d,a,x[i],20,-373897302);a=gg(a,b,c,d,x[i+5],5,-701558691);d=gg(d,a,b,c,x[i+10],9,38016083);c=gg(c,d,a,b,x[i+15],14,-660478335);b=gg(b,c,d,a,x[i+4],20,-405537848);a=gg(a,b,c,d,x[i+9],5,568446438);d=gg(d,a,b,c,x[i+14],9,-1019803690);c=gg(c,d,a,b,x[i+3],14,-187363961);b=gg(b,c,d,a,x[i+8],20,1163531501);a=gg(a,b,c,d,x[i+13],5,-1444681467);d=gg(d,a,b,c,x[i+2],9,-51403784);c=gg(c,d,a,b,x[i+7],14,1735328473);b=gg(b,c,d,a,x[i+12],20,-1926607734);a=hh(a,b,c,d,x[i+5],4,-378558);d=hh(d,a,b,c,x[i+8],11,-2022574463);c=hh(c,d,a,b,x[i+11],16,1839030562);b=hh(b,c,d,a,x[i+14],23,-35309556);a=hh(a,b,c,d,x[i+1],4,-1530992060);d=hh(d,a,b,c,x[i+4],11,1272893353);c=hh(c,d,a,b,x[i+7],16,-155497632);b=hh(b,c,d,a,x[i+10],23,-1094730640);a=hh(a,b,c,d,x[i+13],4,681279174);d=hh(d,a,b,c,x[i],11,-358537222);c=hh(c,d,a,b,x[i+3],16,-722521979);b=hh(b,c,d,a,x[i+6],23,76029189);a=hh(a,b,c,d,x[i+9],4,-640364487);d=hh(d,a,b,c,x[i+12],11,-421815835);c=hh(c,d,a,b,x[i+15],16,530742520);b=hh(b,c,d,a,x[i+2],23,-995338651);a=ii(a,b,c,d,x[i],6,-198630844);d=ii(d,a,b,c,x[i+7],10,1126891415);c=ii(c,d,a,b,x[i+14],15,-1416354905);b=ii(b,c,d,a,x[i+5],21,-57434055);a=ii(a,b,c,d,x[i+12],6,1700485571);d=ii(d,a,b,c,x[i+3],10,-1894986606);c=ii(c,d,a,b,x[i+10],15,-1051523);b=ii(b,c,d,a,x[i+1],21,-2054922799);a=ii(a,b,c,d,x[i+8],6,1873313359);d=ii(d,a,b,c,x[i+15],10,-30611744);c=ii(c,d,a,b,x[i+6],15,-1560198380);b=ii(b,c,d,a,x[i+13],21,1309151649);a=ii(a,b,c,d,x[i+4],6,-145523070);d=ii(d,a,b,c,x[i+11],10,-1120210379);c=ii(c,d,a,b,x[i+2],15,718787259);b=ii(b,c,d,a,x[i+9],21,-343485551);a=safeAdd(a,A);b=safeAdd(b,B);c=safeAdd(c,C);d=safeAdd(d,D);}
  function h(n){let s='',j=0;for(;j<4;j++)s+='0123456789abcdef'[(n>>(j*8+4))&0xf]+'0123456789abcdef'[(n>>(j*8))&0xf];return s;}
  return h(a)+h(b)+h(c)+h(d);
}

function lfmSign(p) { const k=Object.keys(p).filter(k=>k!=='format').sort(); return md5(k.map(k=>k+p[k]).join('')+lfm.apiSecret); }

async function lfmCall(params) {
  params.api_key=lfm.apiKey; params.format='json';
  if (lfm.sessionKey&&!params.sk) params.sk=lfm.sessionKey;
  if (params.sk||params.method==='auth.getMobileSession') params.api_sig=lfmSign(params);
  try { const r=await fetch(LASTFM_API_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params).toString()}); return await r.json(); }
  catch { return null; }
}

async function lfmAuthenticate(username, password) {
  if (!lfm.apiKey||!lfm.apiSecret) { showLfmStatus('Enter API Key and Secret first.','error'); return; }
  showLfmStatus('Authenticating…','pending');
  const res = await lfmCall({method:'auth.getMobileSession',username,password});
  if (res?.session) { lfm.sessionKey=res.session.key; lfm.username=res.session.name; lfm.enabled=true; saveLfmState(); updateLfmUI(); showLfmStatus(`Connected as ${lfm.username} ✓`,'ok'); }
  else showLfmStatus(res?.error?`Error ${res.error}: ${res.message}`:'Auth failed.','error');
}

function lfmDisconnect() { lfm.sessionKey=''; lfm.username=''; lfm.enabled=false; saveLfmState(); updateLfmUI(); showLfmStatus('Disconnected.',''); }

async function lfmUpdateNowPlaying(t) {
  if (!lfm.enabled||!lfm.sessionKey||!t) return;
  await lfmCall({method:'track.updateNowPlaying',track:t.name,artist:t.artist,album:t.album,duration:Math.round(t.duration)});
}

async function lfmScrobble(t, ts) {
  if (!lfm.enabled||!lfm.sessionKey||!t||t.duration<30) return;
  const res = await lfmCall({method:'track.scrobble','track[0]':t.name,'artist[0]':t.artist,'album[0]':t.album,'timestamp[0]':Math.round(ts)});
  if (res?.scrobbles) { showLfmScrobbleBadge(); flushPendingScrobbles(); }
  else { lfm.pendingScrobbles.push({track:t,timestamp:ts}); saveLfmState(); }
}

async function flushPendingScrobbles() {
  if (!lfm.pendingScrobbles.length) return;
  const batch=lfm.pendingScrobbles.splice(0,10);
  const p={method:'track.scrobble'};
  batch.forEach((s,i)=>{p[`track[${i}]`]=s.track.name;p[`artist[${i}]`]=s.track.artist;p[`timestamp[${i}]`]=Math.round(s.timestamp);});
  await lfmCall(p); saveLfmState();
}

function showLfmStatus(msg, type) { const el=document.getElementById('lfmStatus'); if(el){el.textContent=msg;el.className='lfm-status '+(type||'');} }

function showLfmScrobbleBadge() {
  const b=document.getElementById('lfmBadge'); if(!b) return;
  b.classList.add('visible'); clearTimeout(b._t); b._t=setTimeout(()=>b.classList.remove('visible'),3000);
}

function updateLfmUI() {
  const c=!!lfm.sessionKey;
  const cs=document.getElementById('lfmConnected'); const ds=document.getElementById('lfmDisconnected');
  if(cs) cs.style.display=c?'':'none'; if(ds) ds.style.display=c?'none':'';
  const ud=document.getElementById('lfmUserDisplay'); if(ud) ud.textContent=lfm.username||'';
  const ki=document.getElementById('lfmApiKey'); const si=document.getElementById('lfmApiSecret');
  if(ki) ki.value=lfm.apiKey||''; if(si) si.value=lfm.apiSecret||'';
  const b=document.getElementById('lfmBadge'); if(b) b.style.display=c?'':'none';
}

function lfmSaveCredentials() {
  lfm.apiKey=document.getElementById('lfmApiKey').value.trim();
  lfm.apiSecret=document.getElementById('lfmApiSecret').value.trim();
  saveLfmState(); showLfmStatus('Credentials saved.','ok');
}

function lfmLogin() {
  const u=document.getElementById('lfmUser').value.trim();
  const p=document.getElementById('lfmPass').value.trim();
  if(!u||!p){showLfmStatus('Enter username and password.','error');return;}
  lfmAuthenticate(u,p);
}

/* ─── Utils ──────────────────────────────────────────*/
function formatTime(s) {
  if (!s||isNaN(s)) return '0:00';
  return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function musicSVG(size) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" width="${size}" height="${size}"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`; }

updateVolumeUI();
updateLfmUI();
loadConfig();

/* ─── Context Menu ───────────────────────────────────*/
let ctxTrackId = null;

function showContextMenu(e, trackId) {
  e.preventDefault();
  e.stopPropagation();
  ctxTrackId = trackId;
  const menu = document.getElementById('contextMenu');

  // Build playlist list directly in menu (no hover submenu)
  const entries = Object.entries(playlists);
  let playlistItems = '';
  if (!entries.length) {
    playlistItems = '<div class="ctx-item ctx-disabled" style="padding-left:28px">No playlists yet</div>';
  } else {
    playlistItems = entries.map(([id, pl]) =>
      `<div class="ctx-item" style="padding-left:28px" onclick="ctxAddToPlaylist('${id}')">${esc(pl.name)}</div>`
    ).join('');
  }

  menu.innerHTML = `
    <div class="ctx-item" onclick="ctxPlayNext()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="14" height="14"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2" fill="none"/></svg>
      Play next
    </div>
    <div class="ctx-separator"></div>
    <div class="ctx-item ctx-disabled" style="font-size:11px;color:var(--text3);cursor:default">Add to playlist</div>
    ${playlistItems}
  `;

  // Position menu
  menu.style.display = 'block';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > window.innerWidth)  x = window.innerWidth  - mw - 4;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 4;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
}

function showQueueContextMenu(e, trackId) {
  e.preventDefault();
  e.stopPropagation();
  ctxTrackId = trackId;
  const menu = document.getElementById('contextMenu');
  const t = tracks.find(t => t.id === trackId);
  const isPlaying = trackId === currentIndex;

  menu.innerHTML = `
    <div class="ctx-item ctx-disabled" style="font-size:11px;color:var(--text3);cursor:default;max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(t ? t.name : '')}</div>
    <div class="ctx-separator"></div>
    ${!isPlaying ? `<div class="ctx-item ctx-danger" onclick="removeFromQueue(${trackId})">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      Remove from queue
    </div>` : '<div class="ctx-item ctx-disabled">Currently playing</div>'}
  `;

  menu.style.display = 'block';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > window.innerWidth)  x = window.innerWidth  - mw - 4;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 4;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
}

function hideContextMenu() {
  document.getElementById('contextMenu').style.display = 'none';
  ctxTrackId = null;
}

function removeFromQueue(trackId) {
  const idx = tracks.findIndex(t => t.id === trackId);
  if (idx < 0) { hideContextMenu(); return; }
  tracks.splice(idx, 1);
  filteredTracks = filteredTracks.filter(t => t.id !== trackId);
  renderQueue();
  renderTrackList();
  hideContextMenu();
}

function ctxAddToPlaylist(playlistId) {
  if (ctxTrackId === null) return;
  addToPlaylist(ctxTrackId, playlistId);
  hideContextMenu();
  if (currentView === 'playlist-custom' && currentPlaylistId === playlistId) openPlaylist(playlistId);
}

function ctxPlayNext() {
  if (ctxTrackId === null) return;
  const fromIdx = tracks.findIndex(t => t.id === ctxTrackId);
  if (fromIdx < 0) { hideContextMenu(); return; }
  const [moved] = tracks.splice(fromIdx, 1);
  const insertAt = tracks.findIndex(t => t.id === currentIndex) + 1;
  tracks.splice(insertAt, 0, moved);
  filteredTracks = [...tracks];
  renderQueue();
  renderTrackList();
  hideContextMenu();
}

document.addEventListener('click', e => {
  const menu = document.getElementById('contextMenu');
  if (menu && !menu.contains(e.target)) hideContextMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenu(); });

/* ─── Background Effects ─────────────────────────────*/
let bgEffect = 'none';
let bgAnimId = null;
const bgCanvas = document.getElementById('bgCanvas');
const bgCtx = bgCanvas ? bgCanvas.getContext('2d') : null;
let bgParticles = [];

function resizeBgCanvas() {
  if (!bgCanvas) return;
  bgCanvas.width  = window.innerWidth;
  bgCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeBgCanvas);
resizeBgCanvas();

function setBgEffect(name, btn) {
  bgEffect = name;
  document.querySelectorAll('.bg-option').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  stopBgEffect();
  if (name !== 'none') startBgEffect(name);
  saveConfig();
}

function stopBgEffect() {
  if (bgAnimId) { cancelAnimationFrame(bgAnimId); bgAnimId = null; }
  if (bgCtx) bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  bgParticles = [];
}

function startBgEffect(name) {
  if (!bgCanvas || !bgCtx) return;
  const W = () => bgCanvas.width, H = () => bgCanvas.height;

  if (name === 'rain') {
    for (let i = 0; i < 120; i++) bgParticles.push({
      x: Math.random()*W(), y: Math.random()*H(),
      len: 10+Math.random()*20, speed: 4+Math.random()*6,
      opacity: 0.2+Math.random()*0.4
    });
    const draw = () => {
      bgCtx.clearRect(0,0,W(),H());
      bgParticles.forEach(p => {
        bgCtx.strokeStyle = `rgba(174,214,241,${p.opacity})`;
        bgCtx.lineWidth = 1;
        bgCtx.beginPath();
        bgCtx.moveTo(p.x, p.y);
        bgCtx.lineTo(p.x-2, p.y+p.len);
        bgCtx.stroke();
        p.y += p.speed; p.x -= 1;
        if (p.y > H()) { p.y = -p.len; p.x = Math.random()*W(); }
      });
      bgAnimId = requestAnimationFrame(draw);
    };
    draw();
  }

  else if (name === 'snow') {
    for (let i = 0; i < 100; i++) bgParticles.push({
      x: Math.random()*W(), y: Math.random()*H(),
      r: 1+Math.random()*3, speed: 0.5+Math.random()*1.5,
      drift: (Math.random()-0.5)*0.5, opacity: 0.3+Math.random()*0.5
    });
    const draw = () => {
      bgCtx.clearRect(0,0,W(),H());
      bgParticles.forEach(p => {
        bgCtx.fillStyle = `rgba(255,255,255,${p.opacity})`;
        bgCtx.beginPath();
        bgCtx.arc(p.x, p.y, p.r, 0, Math.PI*2);
        bgCtx.fill();
        p.y += p.speed; p.x += p.drift;
        if (p.y > H()) { p.y = -5; p.x = Math.random()*W(); }
        if (p.x > W()) p.x = 0;
        if (p.x < 0) p.x = W();
      });
      bgAnimId = requestAnimationFrame(draw);
    };
    draw();
  }

  else if (name === 'stars') {
    for (let i = 0; i < 150; i++) bgParticles.push({
      x: Math.random()*W(), y: Math.random()*H(),
      r: 0.5+Math.random()*1.5,
      twinkle: Math.random()*Math.PI*2, speed: 0.02+Math.random()*0.04
    });
    const draw = () => {
      bgCtx.clearRect(0,0,W(),H());
      bgParticles.forEach(p => {
        p.twinkle += p.speed;
        const op = 0.3 + 0.5 * Math.abs(Math.sin(p.twinkle));
        bgCtx.fillStyle = `rgba(255,255,255,${op})`;
        bgCtx.beginPath();
        bgCtx.arc(p.x, p.y, p.r, 0, Math.PI*2);
        bgCtx.fill();
      });
      bgAnimId = requestAnimationFrame(draw);
    };
    draw();
  }

  else if (name === 'fireflies') {
    for (let i = 0; i < 40; i++) bgParticles.push({
      x: Math.random()*W(), y: Math.random()*H(),
      vx: (Math.random()-0.5)*0.8, vy: (Math.random()-0.5)*0.8,
      phase: Math.random()*Math.PI*2, r: 2+Math.random()*3
    });
    const draw = () => {
      bgCtx.clearRect(0,0,W(),H());
      bgParticles.forEach(p => {
        p.phase += 0.03; p.x += p.vx; p.y += p.vy;
        if (p.x < 0||p.x > W()) p.vx *= -1;
        if (p.y < 0||p.y > H()) p.vy *= -1;
        const op = 0.2+0.7*Math.abs(Math.sin(p.phase));
        const grd = bgCtx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*3);
        grd.addColorStop(0, `rgba(167,239,139,${op})`);
        grd.addColorStop(1, 'rgba(167,239,139,0)');
        bgCtx.fillStyle = grd;
        bgCtx.beginPath();
        bgCtx.arc(p.x, p.y, p.r*3, 0, Math.PI*2);
        bgCtx.fill();
      });
      bgAnimId = requestAnimationFrame(draw);
    };
    draw();
  }

  else if (name === 'matrix') {
    const cols = Math.floor(W()/16);
    const drops = Array(cols).fill(0).map(() => Math.random()*H()/16 | 0);
    const chars = 'アイウエオカキクケコサシスセソ01アロラ'.split('');
    const draw = () => {
      bgCtx.fillStyle = 'rgba(0,0,0,0.05)';
      bgCtx.fillRect(0,0,W(),H());
      bgCtx.fillStyle = 'rgba(0,255,70,0.6)';
      bgCtx.font = '14px monospace';
      drops.forEach((y, i) => {
        const ch = chars[Math.floor(Math.random()*chars.length)];
        bgCtx.fillText(ch, i*16, y*16);
        if (y*16 > H() && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      });
      bgAnimId = requestAnimationFrame(draw);
    };
    draw();
  }
}

/* ─── Sleep Timer ────────────────────────────────────*/
let sleepTimerId = null;
let sleepTimerEnd = 0;
let sleepTimerTickId = null;

function setSleepTimer(minutes) {
  clearTimeout(sleepTimerId);
  clearInterval(sleepTimerTickId);
  const badge = document.getElementById('sleepTimerBadge');
  if (!minutes || minutes === '0') {
    if (badge) badge.style.display = 'none';
    saveConfig();
    return;
  }
  const ms = parseInt(minutes) * 60000;
  sleepTimerEnd = Date.now() + ms;
  if (badge) badge.style.display = '';
  sleepTimerId = setTimeout(() => {
    audio.pause();
    isPlaying = false;
    updatePlayBtn(); updateSpinning();
    if (badge) badge.style.display = 'none';
    clearInterval(sleepTimerTickId);
    const sel = document.getElementById('sleepTimerSelect');
    if (sel) sel.value = '0';
  }, ms);
  // Update countdown display every second
  sleepTimerTickId = setInterval(() => {
    const left = Math.max(0, sleepTimerEnd - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    if (badge) badge.textContent = `💤 ${m}:${s.toString().padStart(2,'0')}`;
  }, 1000);
  saveConfig();
}

/* ─── Playback Speed ─────────────────────────────────*/
let playbackSpeed = 1.0;

function changeSpeed(delta) {
  playbackSpeed = Math.max(0.25, Math.min(3.0, playbackSpeed + delta));
  playbackSpeed = Math.round(playbackSpeed * 4) / 4; // snap to 0.25 steps
  audio.playbackRate = playbackSpeed;
  const label = document.getElementById('speedLabel');
  if (label) label.textContent = playbackSpeed + '×';
  saveConfig();
}

/* ─── Liked Songs View ───────────────────────────────*/
function renderLikedSongs() {
  const list = document.getElementById('likedTrackList');
  if (!list) return;
  const likedTracks = tracks.filter(t => liked.has(t.id));
  if (!likedTracks.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">${musicSVG(48)}</div><p>Heart a track to add it here</p></div>`;
    return;
  }
  list.innerHTML = likedTracks.map((t, i) => {
    const art = getArt(t.id);
    return `<div class="track-row${currentIndex===t.id?' active':''}" data-id="${t.id}" onclick="playTrack(${t.id})" style="animation-delay:${i*0.02}s">
      <div class="track-num">${currentIndex===t.id&&isPlaying?'▶':i+1}</div>
      <div class="track-info">
        <div class="track-thumb">${art?`<img src="${art}" alt="" loading="lazy">`:musicSVG(14)}</div>
        <div class="track-titles"><div class="track-title">${esc(t.name)}</div></div>
      </div>
      <div class="track-artist">${esc(t.artist)}</div>
      <div class="track-album">${esc(t.album)}</div>
      <div class="track-dur">${formatTime(t.duration)}</div>
    </div>`;
  }).join('');
}

/* ─── Stats View ─────────────────────────────────────*/
function renderStats() {
  const grid = document.getElementById('statsGrid');
  if (!grid) return;

  const totalTracks = tracks.length;
  const totalListenSecs = Object.values(listenLog).reduce((a,b) => a+b, 0);
  const likedCount = liked.size;
  const playlistCount = Object.keys(playlists).length;
  const topArtists = {};
  tracks.forEach(t => { topArtists[t.artist] = (topArtists[t.artist]||0) + 1; });
  const topArtist = Object.entries(topArtists).sort((a,b)=>b[1]-a[1])[0]?.[0] || '—';
  const topTrackEntry = Object.entries(listenLog).sort((a,b)=>b[1]-a[1])[0];
  const topTrack = topTrackEntry ? topTrackEntry[0].split('|||')[0] : '—';
  const uniqueAlbums = new Set(tracks.map(t=>t.album)).size;

  grid.innerHTML = [
    { label:'Tracks in library', value: totalTracks },
    { label:'Total listen time', value: formatListenTime(totalListenSecs) },
    { label:'Liked songs', value: likedCount },
    { label:'Playlists', value: playlistCount },
    { label:'Most played track', value: topTrack, small: true },
    { label:'Top artist', value: topArtist, small: true },
    { label:'Unique albums', value: uniqueAlbums },
    { label:'Unique artists', value: Object.keys(topArtists).length },
  ].map(s => `
    <div class="stat-card">
      <div class="stat-value" style="${s.small?'font-size:18px':''}">${esc(String(s.value))}</div>
      <div class="stat-label">${s.label}</div>
    </div>
  `).join('');
}

/* ─── Context Menu ───────────────────────────────────*/
function showContextMenu(e, trackId) {
  e.preventDefault();
  const menu = document.getElementById('contextMenu');
  if (!menu) return;

  const playlistItems = Object.entries(playlists).map(([id, pl]) => `
    <div class="context-item" onclick="addToPlaylist(${trackId},'${id}');hideContextMenu()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add to ${esc(pl.name)}
    </div>`).join('');

  menu.innerHTML = `
    <div class="context-item" onclick="playTrack(${trackId});hideContextMenu()">
      <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      Play
    </div>
    <div class="context-item" onclick="playNext_specific(${trackId});hideContextMenu()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
      Play Next
    </div>
    <div class="context-separator"></div>
    <div class="context-item" onclick="toggleLikeById(${trackId});hideContextMenu()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      ${liked.has(trackId) ? 'Unlike' : 'Like'}
    </div>
    ${playlistItems ? '<div class="context-separator"></div>' + playlistItems : ''}
  `;

  menu.style.display = 'block';
  const x = Math.min(e.clientX, window.innerWidth  - menu.offsetWidth  - 8);
  const y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 0);
}

function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) menu.style.display = 'none';
}

function playNext_specific(id) {
  const idx = tracks.findIndex(t => t.id === currentIndex);
  const track = tracks.find(t => t.id === id);
  if (!track) return;
  // Remove if already in list, insert after current
  const filtered = tracks.filter(t => t.id !== id);
  filtered.splice(idx + 1, 0, track);
  tracks.length = 0;
  filtered.forEach(t => tracks.push(t));
  renderQueue();
}

function toggleLikeById(id) {
  liked.has(id) ? liked.delete(id) : liked.add(id);
  if (currentIndex === id)
    document.getElementById('heartBtn').classList.toggle('liked', liked.has(id));
  if (currentView === 'liked') renderLikedSongs();
}

/* ─── Patch setView to handle new views ─────────────*/
const _origSetView = setView;
// Override setView to handle liked + stats
window.setView = function(name, btn) {
  currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(`view-${name}`);
  if (view) view.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (name === 'albums') renderAlbums();
  if (name === 'artists') renderArtists();
  if (name === 'playlist-onrepeat') renderOnRepeat();
  if (name === 'liked') renderLikedSongs();
  if (name === 'stats') renderStats();
};

/* ─── Patch renderTrackList rows to have context menu */
const _origRenderTrackList = renderTrackList;
window.renderTrackList = function(list, containerId, showPlaytime) {
  _origRenderTrackList(list, containerId, showPlaytime);
  // Add right-click listeners after render
  const cid = containerId || 'trackList';
  document.querySelectorAll(`#${cid} .track-row`).forEach(row => {
    row.addEventListener('contextmenu', e => showContextMenu(e, parseInt(row.dataset.id)));
  });
};

/* ─── Patch saveConfig/loadConfig for new settings ──*/
const _origSaveConfig = saveConfig;
window.saveConfig = async function() {
  config.bgEffect = bgEffect;
  config.playbackSpeed = playbackSpeed;
  config.liked = [...liked];
  await _origSaveConfig();
};

const _origLoadConfig = loadConfig;
window.loadConfig = async function() {
  await _origLoadConfig();
  // Apply background effect
  if (config.bgEffect && config.bgEffect !== 'none') {
    bgEffect = config.bgEffect;
    const btn = document.querySelector(`.bg-option[data-bg="${bgEffect}"]`);
    startBgEffect(bgEffect);
    document.querySelectorAll('.bg-option').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }
  // Apply playback speed
  if (config.playbackSpeed) {
    playbackSpeed = config.playbackSpeed;
    audio.playbackRate = playbackSpeed;
    const label = document.getElementById('speedLabel');
    if (label) label.textContent = playbackSpeed + '×';
  }
  // Restore liked songs
  if (config.liked) {
    liked.clear();
    config.liked.forEach(id => liked.add(id));
  }
};
