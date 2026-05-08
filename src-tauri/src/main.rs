#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::thread;
use tiny_http::{Header, Response, Server};
use percent_encoding::percent_decode_str;

const STREAM_PORT: u16 = 17432;

fn mime_for_ext(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "mp3"  => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg"  => "audio/ogg",
        "wav"  => "audio/wav",
        "m4a"  => "audio/mp4",
        "aac"  => "audio/aac",
        "opus" => "audio/opus",
        "wma"  => "audio/x-ms-wma",
        _      => "application/octet-stream",
    }
}

fn start_stream_server() {
    thread::spawn(move || {
        let server = Server::http(format!("127.0.0.1:{}", STREAM_PORT))
            .expect("Failed to start stream server");

        for request in server.incoming_requests() {
            let url = request.url().to_string();

            // CORS preflight
            if request.method() == &tiny_http::Method::Options {
                let _ = request.respond(
                    Response::empty(200)
                        .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap())
                        .with_header(Header::from_bytes("Access-Control-Allow-Methods", "GET, HEAD").unwrap()),
                );
                continue;
            }

            // /stream?path=/absolute/path/to/file.mp3
            let file_path = if url.starts_with("/stream?path=") {
                let encoded = url.trim_start_matches("/stream?path=");
                percent_decode_str(encoded)
                    .decode_utf8()
                    .map(|s| PathBuf::from(s.as_ref()))
                    .ok()
            } else {
                None
            };

            let path = match file_path {
                Some(p) if p.exists() && p.is_file() => p,
                _ => { let _ = request.respond(Response::empty(404)); continue; }
            };

            let ext  = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let mime = mime_for_ext(ext);
            let file_size = match std::fs::metadata(&path) {
                Ok(m) => m.len(),
                Err(_) => { let _ = request.respond(Response::empty(500)); continue; }
            };

            // Range header support (needed for seeking)
            let range_header = request
                .headers()
                .iter()
                .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("range"))
                .map(|h| h.value.as_str().to_string());

            let (start, end, status) = if let Some(range) = range_header {
                let range = range.trim_start_matches("bytes=");
                let parts: Vec<&str> = range.splitn(2, '-').collect();
                let s = parts.get(0).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                let e = parts.get(1).and_then(|s| s.parse::<u64>().ok()).unwrap_or(file_size - 1);
                (s, e.min(file_size - 1), 206u16)
            } else {
                (0, file_size - 1, 200u16)
            };

            let chunk = end - start + 1;
            let mut file = match File::open(&path) {
                Ok(f) => f,
                Err(_) => { let _ = request.respond(Response::empty(500)); continue; }
            };
            if file.seek(SeekFrom::Start(start)).is_err() {
                let _ = request.respond(Response::empty(500)); continue;
            }
            let mut buf = vec![0u8; chunk as usize];
            let n = file.read(&mut buf).unwrap_or(0);
            buf.truncate(n);

            let _ = request.respond(
                Response::from_data(buf)
                    .with_status_code(status)
                    .with_header(Header::from_bytes("Content-Type",   mime).unwrap())
                    .with_header(Header::from_bytes("Content-Length", chunk.to_string()).unwrap())
                    .with_header(Header::from_bytes("Accept-Ranges",  "bytes").unwrap())
                    .with_header(Header::from_bytes("Content-Range",
                        format!("bytes {}-{}/{}", start, end, file_size)).unwrap())
                    .with_header(Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap())
                    .with_header(Header::from_bytes("Cache-Control",  "no-store").unwrap()),
            );
        }
    });
}

#[tauri::command]
fn get_stream_port() -> u16 { STREAM_PORT }

fn main() {
    start_stream_server();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![get_stream_port])
        .run(tauri::generate_context!())
        .expect("error while running Aurora");
}
