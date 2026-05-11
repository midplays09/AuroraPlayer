#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

struct Rpc(Mutex<Option<DiscordIpcClient>>);

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

fn connect() -> Option<DiscordIpcClient> {
    let mut c = DiscordIpcClient::new("1502706759129628794").ok()?;
    c.connect().ok()?;
    Some(c)
}

#[tauri::command]
fn rpc_update(
    state: State<Rpc>,
    track: String,
    artist: String,
    album: String,
    playing: bool,
    position: f64,
    duration: f64,
) {
    let mut guard = state.0.lock().unwrap();
    if guard.is_none() { *guard = connect(); }
    let client = match guard.as_mut() { Some(c) => c, None => return };

    let now   = now_secs();
    let start = now - position as i64;
    let end   = now + (duration - position) as i64;

    let details = track.chars().take(128).collect::<String>();
    let state_s = if artist.is_empty() { "Unknown Artist".into() }
                  else { artist.chars().take(128).collect::<String>() };
    let album_s = if album.is_empty() { "Aurora Player".to_string() }
                  else { album.chars().take(128).collect::<String>() };

    let ts = if playing && duration > 1.0 {
        activity::Timestamps::new().start(start).end(end)
    } else {
        activity::Timestamps::new().start(now)
    };

    let assets = activity::Assets::new()
        .large_image("aurora_logo")
        .large_text(&album_s)
        .small_image(if playing { "playing" } else { "paused" })
        .small_text(if playing { "Playing" } else { "Paused" });

    let btn = activity::Button::new(
        "Aurora Player",
        "https://github.com/midplays09/auroraPlayer"
    );

    let payload = activity::Activity::new()
        .details(&details)
        .state(&state_s)
        .timestamps(ts)
        .assets(assets)
        .buttons(vec![btn]);

    if client.set_activity(payload).is_err() {
        let _ = client.close();
        *guard = None;
    }
}

#[tauri::command]
fn rpc_clear(state: State<Rpc>) {
    let mut guard = state.0.lock().unwrap();
    if let Some(c) = guard.as_mut() {
        let _ = c.clear_activity();
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Rpc(Mutex::new(connect())))
        .invoke_handler(tauri::generate_handler![rpc_update, rpc_clear])
        .run(tauri::generate_context!())
        .expect("error while running Aurora");
}
