//! RTMP publisher using rml_rtmp (handshake, connect, publish, FLV A/V).

use crate::flv::{aac_raw_frame, aac_sequence_header, avc_nalu, avc_sequence_header, silent_aac_adts};
use rml_rtmp::handshake::{Handshake, HandshakeProcessResult, PeerType};
use rml_rtmp::sessions::{
    ClientSession, ClientSessionConfig, ClientSessionEvent, ClientSessionResult, PublishRequestType,
    StreamMetadata,
};
use rml_rtmp::time::RtmpTimestamp;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use url::Url;

#[derive(Debug, Clone)]
pub struct RtmpTarget {
    pub host: String,
    pub port: u16,
    pub app: String,
    pub stream_key: String,
}

impl RtmpTarget {
    /// Parse `rtmp://host[:port]/app/stream_key` or server URL + separate key.
    pub fn from_url(server_url: &str, stream_key: &str) -> Result<Self, String> {
        let key = stream_key.trim();
        if key.is_empty() {
            return Err("stream key is required".into());
        }

        let url_str = server_url.trim();
        if url_str.is_empty() {
            return Err("RTMP server URL is required".into());
        }

        // If the key is already embedded in the URL path, split it out.
        if let Ok(parsed) = Url::parse(url_str) {
            if parsed.scheme() == "rtmp" || parsed.scheme() == "rtmps" {
                let host = parsed
                    .host_str()
                    .ok_or_else(|| "RTMP URL missing host".to_string())?
                    .to_string();
                let port = parsed.port().unwrap_or(1935);
                let mut segments: Vec<&str> = parsed.path().trim_start_matches('/').split('/').collect();
                segments.retain(|s| !s.is_empty());
                if segments.len() >= 2 {
                    let app = segments[0].to_string();
                    let embedded_key = segments[1..].join("/");
                    return Ok(Self {
                        host,
                        port,
                        app,
                        stream_key: embedded_key,
                    });
                }
                if segments.len() == 1 {
                    return Ok(Self {
                        host,
                        port,
                        app: segments[0].to_string(),
                        stream_key: key.to_string(),
                    });
                }
                return Err("RTMP URL must include an application name (e.g. rtmp://host/live)".into());
            }
        }

        // Treat as host[/app] with separate key.
        let normalized = url_str
            .trim_start_matches("rtmp://")
            .trim_start_matches("rtmps://");
        let (host_port, app) = normalized.split_once('/').unwrap_or((normalized, "live"));
        let (host, port) = if let Some((h, p)) = host_port.split_once(':') {
            (h.to_string(), p.parse::<u16>().unwrap_or(1935))
        } else {
            (host_port.to_string(), 1935)
        };
        Ok(Self {
            host,
            port,
            app: app.to_string(),
            stream_key: key.to_string(),
        })
    }
}

pub enum StreamCommand {
    Video {
        data: Vec<u8>,
        timestamp_ms: u32,
        is_keyframe: bool,
    },
    Stop,
}

pub struct RtmpPublisher {
    cmd_tx: Sender<StreamCommand>,
    thread: Option<JoinHandle<()>>,
    running: Arc<AtomicBool>,
    error: Arc<parking_lot::Mutex<Option<String>>>,
    bytes_sent: Arc<std::sync::atomic::AtomicU64>,
    frames_sent: Arc<std::sync::atomic::AtomicU64>,
}

impl RtmpPublisher {
    pub fn start(
        target: RtmpTarget,
        width: u32,
        height: u32,
        fps: u32,
        bitrate_kbps: u32,
    ) -> Result<Self, String> {
        let (cmd_tx, cmd_rx) = mpsc::channel();
        let running = Arc::new(AtomicBool::new(true));
        let error = Arc::new(parking_lot::Mutex::new(None));
        let bytes_sent = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let frames_sent = Arc::new(std::sync::atomic::AtomicU64::new(0));

        let running_t = running.clone();
        let error_t = error.clone();
        let bytes_sent_t = bytes_sent.clone();
        let frames_sent_t = frames_sent.clone();

        let thread = thread::Builder::new()
            .name("rtmp-publish".into())
            .spawn(move || {
                if let Err(e) = run_publish_loop(
                    target,
                    width,
                    height,
                    fps,
                    bitrate_kbps,
                    cmd_rx,
                    &running_t,
                    &error_t,
                    &bytes_sent_t,
                    &frames_sent_t,
                ) {
                    *error_t.lock() = Some(e);
                }
                running_t.store(false, Ordering::SeqCst);
            })
            .map_err(|e| format!("failed to start RTMP thread: {e}"))?;

        Ok(Self {
            cmd_tx,
            thread: Some(thread),
            running,
            error,
            bytes_sent,
            frames_sent,
        })
    }

    pub fn push_video(&self, data: Vec<u8>, timestamp_ms: u32, is_keyframe: bool) {
        let _ = self.cmd_tx.send(StreamCommand::Video {
            data,
            timestamp_ms,
            is_keyframe,
        });
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn last_error(&self) -> Option<String> {
        self.error.lock().clone()
    }

    pub fn stats(&self) -> (u64, u64) {
        (
            self.bytes_sent.load(Ordering::Relaxed),
            self.frames_sent.load(Ordering::Relaxed),
        )
    }
}

impl Drop for RtmpPublisher {
    fn drop(&mut self) {
        let _ = self.cmd_tx.send(StreamCommand::Stop);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn run_publish_loop(
    target: RtmpTarget,
    width: u32,
    height: u32,
    fps: u32,
    bitrate_kbps: u32,
    cmd_rx: Receiver<StreamCommand>,
    running: &AtomicBool,
    error: &parking_lot::Mutex<Option<String>>,
    bytes_sent: &std::sync::atomic::AtomicU64,
    frames_sent: &std::sync::atomic::AtomicU64,
) -> Result<(), String> {
    let addr = format!("{}:{}", target.host, target.port);
    let mut stream = TcpStream::connect(&addr).map_err(|e| format!("RTMP connect {addr}: {e}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(50)))
        .ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();
    stream.set_nodelay(true).ok();

    // RTMP handshake
    let mut handshake = Handshake::new(PeerType::Client);
    let p0p1 = handshake
        .generate_outbound_p0_and_p1()
        .map_err(|e| format!("handshake p0p1: {e}"))?;
    stream
        .write_all(&p0p1)
        .map_err(|e| format!("handshake write: {e}"))?;

    let mut buf = [0u8; 3072];
    let mut accumulated = Vec::new();
    loop {
        match stream.read(&mut buf) {
            Ok(0) => return Err("RTMP server closed during handshake".into()),
            Ok(n) => accumulated.extend_from_slice(&buf[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                if accumulated.len() >= 3073 {
                    break;
                }
                thread::sleep(Duration::from_millis(10));
                continue;
            }
            Err(e) => return Err(format!("handshake read: {e}")),
        }
        if accumulated.len() >= 3073 {
            break;
        }
    }

    match handshake
        .process_bytes(&accumulated)
        .map_err(|e| format!("handshake process: {e}"))?
    {
        HandshakeProcessResult::Completed {
            response_bytes,
            remaining_bytes,
        } => {
            stream
                .write_all(&response_bytes)
                .map_err(|e| format!("handshake p2 write: {e}"))?;
            accumulated = remaining_bytes;
        }
        HandshakeProcessResult::InProgress { .. } => {
            return Err("RTMP handshake incomplete".into());
        }
    }

    let config = ClientSessionConfig::new();
    let (mut session, initial) = ClientSession::new(config).map_err(|e| format!("session: {e}"))?;
    for result in initial {
        if let ClientSessionResult::OutboundResponse(packet) = result {
            stream
                .write_all(&packet.bytes)
                .map_err(|e| format!("write initial: {e}"))?;
            bytes_sent.fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
        }
    }

    // Drain handshake remainder through session
    if !accumulated.is_empty() {
        drain_session_input(&mut session, &mut stream, &accumulated, bytes_sent)?;
    }

    // Connect to application
    let connect = session
        .request_connection(target.app.clone())
        .map_err(|e| format!("request_connection: {e}"))?;
    if let ClientSessionResult::OutboundResponse(packet) = connect {
        stream
            .write_all(&packet.bytes)
            .map_err(|e| format!("connect write: {e}"))?;
        bytes_sent.fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
    }
    wait_for_event(&mut session, &mut stream, |e| {
        matches!(e, ClientSessionEvent::ConnectionRequestAccepted)
    }, bytes_sent)?;

    // Open publish stream
    let publish = session
        .request_publishing(target.stream_key.clone(), PublishRequestType::Live)
        .map_err(|e| format!("request_publishing: {e}"))?;
    if let ClientSessionResult::OutboundResponse(packet) = publish {
        stream
            .write_all(&packet.bytes)
            .map_err(|e| format!("publish write: {e}"))?;
        bytes_sent.fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
    }
    wait_for_event(&mut session, &mut stream, |e| {
        matches!(e, ClientSessionEvent::PublishRequestAccepted)
    }, bytes_sent)?;

    // Send onMetaData
    let metadata = StreamMetadata {
        video_width: Some(width),
        video_height: Some(height),
        video_codec_id: Some(7),
        video_frame_rate: Some(fps as f32),
        video_bitrate_kbps: Some(bitrate_kbps),
        audio_codec_id: Some(10),
        audio_bitrate_kbps: Some(128),
        audio_sample_rate: Some(48000),
        audio_channels: Some(2),
        audio_is_stereo: Some(true),
        encoder: Some("ninesixteen.video".to_string()),
    };
    let meta = session
        .publish_metadata(&metadata)
        .map_err(|e| format!("metadata: {e}"))?;
    if let ClientSessionResult::OutboundResponse(packet) = meta {
        stream
            .write_all(&packet.bytes)
            .map_err(|e| format!("metadata write: {e}"))?;
        bytes_sent.fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
    }

    // AAC sequence header
    let aac_seq = aac_sequence_header();
    let aac_ts = RtmpTimestamp::new(0);
    let aac_pkt = session
        .publish_audio_data(aac_seq, aac_ts, false)
        .map_err(|e| format!("aac seq: {e}"))?;
    if let ClientSessionResult::OutboundResponse(packet) = aac_pkt {
        stream
            .write_all(&packet.bytes)
            .map_err(|e| format!("aac seq write: {e}"))?;
        bytes_sent.fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
    }

    let mut avc_config_sent = false;
    let mut last_audio_ts: u32 = 0;
    let audio_interval_ms = 1024 * 1000 / 48000; // ~21ms per AAC frame

    while running.load(Ordering::SeqCst) {
        // Read any server data (pings, acks)
        let mut inbound = [0u8; 4096];
        match stream.read(&mut inbound) {
            Ok(0) => return Err("RTMP server closed connection".into()),
            Ok(n) => {
                let results = session
                    .handle_input(&inbound[..n])
                    .map_err(|e| format!("session input: {e}"))?;
                for result in results {
                    if let ClientSessionResult::OutboundResponse(packet) = result {
                        stream.write_all(&packet.bytes).ok();
                        bytes_sent.fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => return Err(format!("rtmp read: {e}")),
        }

        match cmd_rx.recv_timeout(Duration::from_millis(5)) {
            Ok(StreamCommand::Video {
                data,
                timestamp_ms,
                is_keyframe,
            }) => {
                if let Some((sps, pps, slices, key)) = crate::flv::parse_access_unit(&data) {
                    if !avc_config_sent {
                        let seq = avc_sequence_header(&sps, &pps);
                        let pkt = session
                            .publish_video_data(seq, RtmpTimestamp::new(timestamp_ms), false)
                            .map_err(|e| format!("avc seq: {e}"))?;
                        if let ClientSessionResult::OutboundResponse(packet) = pkt {
                            stream
                                .write_all(&packet.bytes)
                                .map_err(|e| format!("avc seq write: {e}"))?;
                            bytes_sent.fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
                        }
                        avc_config_sent = true;
                    }
                    let avcc = crate::flv::annex_b_to_avcc(&slices);
                    let tag = avc_nalu(&avcc, timestamp_ms, key || is_keyframe);
                    let pkt = session
                        .publish_video_data(tag, RtmpTimestamp::new(timestamp_ms), false)
                        .map_err(|e| format!("video: {e}"))?;
                    if let ClientSessionResult::OutboundResponse(packet) = pkt {
                        stream
                            .write_all(&packet.bytes)
                            .map_err(|e| format!("video write: {e}"))?;
                        bytes_sent.fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
                    }
                    frames_sent.fetch_add(1, Ordering::Relaxed);
                }

                // Keep audio clock alive with silent AAC frames.
                if timestamp_ms.saturating_sub(last_audio_ts) >= audio_interval_ms {
                    let aac = aac_raw_frame(silent_aac_adts());
                    let pkt = session
                        .publish_audio_data(aac, RtmpTimestamp::new(timestamp_ms), true)
                        .map_err(|e| format!("aac: {e}"))?;
                    if let ClientSessionResult::OutboundResponse(packet) = pkt {
                        stream.write_all(&packet.bytes).ok();
                        bytes_sent.fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
                    }
                    last_audio_ts = timestamp_ms;
                }
            }
            Ok(StreamCommand::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }

    let _ = session.stop_publishing();
    Ok(())
}

fn drain_session_input(
    session: &mut ClientSession,
    stream: &mut TcpStream,
    bytes: &[u8],
    bytes_sent: &std::sync::atomic::AtomicU64,
) -> Result<(), String> {
    let results = session
        .handle_input(bytes)
        .map_err(|e| format!("session input: {e}"))?;
    for result in results {
        if let ClientSessionResult::OutboundResponse(packet) = result {
            stream
                .write_all(&packet.bytes)
                .map_err(|e| format!("response write: {e}"))?;
            bytes_sent.fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
        }
    }
    Ok(())
}

fn wait_for_event<F>(
    session: &mut ClientSession,
    stream: &mut TcpStream,
    pred: F,
    bytes_sent: &std::sync::atomic::AtomicU64,
) -> Result<(), String>
where
    F: Fn(&ClientSessionEvent) -> bool,
{
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    let mut buf = [0u8; 4096];
    while std::time::Instant::now() < deadline {
        match stream.read(&mut buf) {
            Ok(0) => return Err("RTMP server closed while waiting for event".into()),
            Ok(n) => {
                let results = session
                    .handle_input(&buf[..n])
                    .map_err(|e| format!("session input: {e}"))?;
                for result in results {
                    match result {
                        ClientSessionResult::RaisedEvent(event) => {
                            if pred(&event) {
                                return Ok(());
                            }
                            if let ClientSessionEvent::ConnectionRequestRejected { description } = &event {
                                return Err(format!("RTMP connection rejected: {description}"));
                            }
                        }
                        ClientSessionResult::OutboundResponse(packet) => {
                            stream.write_all(&packet.bytes).ok();
                            bytes_sent.fetch_add(packet.bytes.len() as u64, Ordering::Relaxed);
                        }
                        _ => {}
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return Err(format!("rtmp read: {e}")),
        }
    }
    Err("timed out waiting for RTMP server response".into())
}
