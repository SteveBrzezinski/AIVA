use crate::{
    run_controller::RunAccess,
    settings::AppSettings,
    tts::{
        speak_text_with_progress_and_control, ProgressCallback, SpeakTextOptions, SpeakTextResult,
        TtsProgress,
    },
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{
    pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey},
    Signer, SigningKey, VerifyingKey,
};
use pkcs8::LineEnding;
use rand_core::OsRng;
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::ErrorKind,
    net::TcpStream,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tungstenite::{stream::MaybeTlsStream, Message as WsMessage, WebSocket};

const OPENCLAW_CONNECT_TIMEOUT_SECS: u64 = 5;
const OPENCLAW_REQUEST_TIMEOUT_SECS: u64 = 120;
const OPENCLAW_GATEWAY_EVENT_POLL_TIMEOUT_MS: u64 = 250;
const OPENCLAW_GATEWAY_CONNECT_TIMEOUT_MS: u64 = 8_000;
const OPENCLAW_GATEWAY_FINAL_RESPONSE_GRACE_MS: u64 = 1_500;
const OPENCLAW_GATEWAY_HISTORY_RETRY_MS: u64 = 350;
const OPENCLAW_DEFAULT_GATEWAY_PORT: u16 = 18_789;
const OPENCLAW_DEFAULT_AGENT_ID: &str = "main";
const OPENCLAW_PREFERRED_AGENT_ID: &str = "voice-overlay";
const OPENCLAW_DEFAULT_SESSION_LABEL: &str = "voice-overlay-assistant";
const OPENCLAW_STREAM_EVENT: &str = "openclaw-stream";
const OPENCLAW_CLIENT_ID: &str = "gateway-client";
const OPENCLAW_CLIENT_DISPLAY_NAME: &str = "Voice Overlay Assistant";
const OPENCLAW_CLIENT_MODE: &str = "backend";
const OPENCLAW_DEVICE_IDENTITY_VERSION: u8 = 1;
const STREAM_CHUNK_MIN_CHARS: usize = 24;
const STREAM_CHUNK_FORCE_CHARS: usize = 110;
const OPENCLAW_OPERATOR_SCOPES: &[&str] = &[
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.pairing",
];

static GATEWAY_REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

type OpenClawSocket = WebSocket<MaybeTlsStream<TcpStream>>;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawVoiceTurnOptions {
    pub transcript: Option<String>,
    pub agent_id: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawBridgeResult {
    pub text: String,
    pub endpoint_url: String,
    pub transport: String,
    pub agent_id: Option<String>,
    pub requested_session_id: Option<String>,
    pub response_session_id: Option<String>,
    pub session_key: Option<String>,
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenClawStreamEvent {
    pub phase: String,
    pub transport: String,
    pub detail: Option<String>,
    pub delta: Option<String>,
    pub accumulated_text: Option<String>,
    pub agent_id: Option<String>,
    pub session_key: Option<String>,
    pub requested_session_id: Option<String>,
    pub response_session_id: Option<String>,
    pub run_id: Option<String>,
    pub tool_name: Option<String>,
    pub tool_phase: Option<String>,
    pub timestamp_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawBridgeRequest<'a> {
    source: &'static str,
    channel: &'static str,
    message: &'a str,
    input: &'a str,
    agent_id: Option<&'a str>,
    session_id: Option<&'a str>,
}

#[derive(Debug, Clone)]
struct OpenClawGatewayConfig {
    url: String,
    auth_mode: String,
    token: Option<String>,
    password: Option<String>,
    agent_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct OpenClawLocalConfigFile {
    gateway: Option<OpenClawLocalGatewayConfigFile>,
    agents: Option<OpenClawLocalAgentsConfigFile>,
}

#[derive(Debug, Deserialize)]
struct OpenClawLocalGatewayConfigFile {
    port: Option<u16>,
    auth: Option<OpenClawLocalGatewayAuthFile>,
}

#[derive(Debug, Deserialize)]
struct OpenClawLocalGatewayAuthFile {
    mode: Option<String>,
    token: Option<String>,
    password: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenClawLocalAgentsConfigFile {
    list: Option<Vec<OpenClawLocalAgentRecord>>,
}

#[derive(Debug, Deserialize)]
struct OpenClawLocalAgentRecord {
    id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawStoredDeviceIdentity {
    version: u8,
    device_id: String,
    public_key_pem: String,
    private_key_pem: String,
    created_at_ms: Option<u64>,
}

#[derive(Debug, Clone)]
struct OpenClawDeviceIdentity {
    device_id: String,
    public_key_pem: String,
    private_key_pem: String,
}

#[derive(Debug)]
enum GatewayRead {
    Event {
        event: String,
        payload: Value,
    },
    Response {
        id: String,
        ok: bool,
        payload: Value,
        error_message: Option<String>,
    },
    Timeout,
    Closed(Option<String>),
    Ignore,
}

#[derive(Debug)]
enum TtsQueueMessage {
    Segment(String),
    Finish,
}

pub fn run_voice_turn(
    options: OpenClawVoiceTurnOptions,
    settings: &AppSettings,
    app: &AppHandle,
    run_access: Option<&RunAccess>,
    progress: Option<ProgressCallback>,
) -> Result<(OpenClawBridgeResult, SpeakTextResult), String> {
    let transcript = options.transcript.clone().unwrap_or_default().trim().to_string();
    if transcript.is_empty() {
        return Err("No transcript provided for the OpenClaw voice turn.".to_string());
    }

    if let Some(run_access) = run_access {
        run_access.check_cancelled()?;
        run_access.update_phase("openclaw_preparing");
    }

    match load_local_gateway_config() {
        Ok(gateway_config) => run_voice_turn_via_gateway(
            options,
            transcript,
            settings,
            app,
            run_access,
            progress,
            gateway_config,
        ),
        Err(gateway_error) => {
            let fallback = submit_voice_turn(options, settings, run_access)?;
            emit_stream_event(
                app,
                OpenClawStreamEvent {
                    phase: "status".to_string(),
                    transport: "http_bridge".to_string(),
                    detail: Some(format!(
                        "Local OpenClaw gateway was unavailable. Falling back to the configured HTTP bridge. Detail: {gateway_error}"
                    )),
                    delta: None,
                    accumulated_text: Some(fallback.text.clone()),
                    agent_id: fallback.agent_id.clone(),
                    session_key: fallback.session_key.clone(),
                    requested_session_id: fallback.requested_session_id.clone(),
                    response_session_id: fallback.response_session_id.clone(),
                    run_id: fallback.run_id.clone(),
                    tool_name: None,
                    tool_phase: None,
                    timestamp_ms: system_time_ms(),
                },
            );
            let speech = speak_full_response(&fallback.text, settings, run_access, progress)?;
            Ok((fallback, speech))
        }
    }
}

pub fn submit_voice_turn(
    options: OpenClawVoiceTurnOptions,
    settings: &AppSettings,
    run_access: Option<&RunAccess>,
) -> Result<OpenClawBridgeResult, String> {
    let transcript = options.transcript.unwrap_or_default().trim().to_string();
    if transcript.is_empty() {
        return Err("No transcript provided for the OpenClaw voice turn.".to_string());
    }

    let endpoint_url = settings.openclaw_endpoint_url.trim().to_string();
    if endpoint_url.is_empty() {
        return Err(
            "OpenClaw endpoint URL is missing and no local OpenClaw gateway configuration was detected."
                .to_string(),
        );
    }

    let agent_id = first_non_empty(
        options.agent_id.as_deref(),
        settings.openclaw_agent_id.as_str(),
    );
    let requested_session_id = first_non_empty(
        options.session_id.as_deref(),
        settings.openclaw_session_id.as_str(),
    );

    if let Some(run_access) = run_access {
        run_access.check_cancelled()?;
        run_access.update_phase("openclaw_request");
    }

    let client = build_openclaw_client()?;
    let response = client
        .post(&endpoint_url)
        .json(&OpenClawBridgeRequest {
            source: "voice-overlay-assistant",
            channel: "voice",
            message: &transcript,
            input: &transcript,
            agent_id: agent_id.as_deref(),
            session_id: requested_session_id.as_deref(),
        })
        .send()
        .map_err(|error| format!("OpenClaw request failed: {error}"))?;

    if let Some(run_access) = run_access {
        run_access.check_cancelled()?;
    }

    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let body = response
        .text()
        .map_err(|error| format!("Failed to read OpenClaw response: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "OpenClaw request failed ({status}): {}",
            compact_response_body(&body)
        ));
    }

    let (text, response_session_id) = parse_openclaw_response(&content_type, &body)?;
    let text = sanitize_assistant_reply_text(&text);

    Ok(OpenClawBridgeResult {
        text,
        endpoint_url,
        transport: "http_bridge".to_string(),
        agent_id,
        requested_session_id,
        response_session_id,
        session_key: None,
        run_id: None,
    })
}

fn run_voice_turn_via_gateway(
    options: OpenClawVoiceTurnOptions,
    transcript: String,
    settings: &AppSettings,
    app: &AppHandle,
    run_access: Option<&RunAccess>,
    progress: Option<ProgressCallback>,
    gateway_config: OpenClawGatewayConfig,
) -> Result<(OpenClawBridgeResult, SpeakTextResult), String> {
    emit_stream_event(
        app,
        OpenClawStreamEvent {
            phase: "status".to_string(),
            transport: "gateway_ws".to_string(),
            detail: Some(format!(
                "Connecting to local OpenClaw gateway at {}.",
                gateway_config.url
            )),
            delta: None,
            accumulated_text: None,
            agent_id: None,
            session_key: None,
            requested_session_id: None,
            response_session_id: None,
            run_id: None,
            tool_name: None,
            tool_phase: None,
            timestamp_ms: system_time_ms(),
        },
    );

    if let Some(run_access) = run_access {
        run_access.check_cancelled()?;
        run_access.update_phase("openclaw_gateway_connect");
    }

    let mut client = OpenClawGatewayClient::connect(&gateway_config)?;
    let agent_id = resolve_gateway_agent_id(&options, settings, &gateway_config);
    let requested_session_id = first_non_empty(
        options.session_id.as_deref(),
        settings.openclaw_session_id.as_str(),
    );
    let session_key = resolve_gateway_session_key(
        &mut client,
        requested_session_id.as_deref(),
        agent_id.as_deref(),
    )?;
    let session_key = client.subscribe_session_messages(&session_key)?;

    emit_stream_event(
        app,
        OpenClawStreamEvent {
            phase: "status".to_string(),
            transport: "gateway_ws".to_string(),
            detail: Some(format!("OpenClaw gateway connected. Using session {session_key}.")),
            delta: None,
            accumulated_text: None,
            agent_id: agent_id.clone(),
            session_key: Some(session_key.clone()),
            requested_session_id: requested_session_id.clone(),
            response_session_id: None,
            run_id: None,
            tool_name: None,
            tool_phase: None,
            timestamp_ms: system_time_ms(),
        },
    );

    if let Some(run_access) = run_access {
        run_access.check_cancelled()?;
        run_access.update_phase("openclaw_gateway_request");
    }

    let chat_idempotency_key = format!("voice-turn-{}", next_gateway_request_id());
    let chat_request_id = client.send_request(
        "chat.send",
        json!({
            "sessionKey": session_key,
            "message": transcript,
            "deliver": false,
            "timeoutMs": OPENCLAW_REQUEST_TIMEOUT_SECS * 1_000,
            "idempotencyKey": chat_idempotency_key,
        }),
    )?;

    let (tts_sender, tts_receiver) = mpsc::channel::<TtsQueueMessage>();
    let tts_settings = settings.clone();
    let tts_progress = wrap_stream_tts_progress(progress);
    let tts_run_access = run_access.cloned();
    let tts_worker = thread::spawn(move || -> Result<Vec<SpeakTextResult>, String> {
        let mut results = Vec::new();

        while let Ok(message) = tts_receiver.recv() {
            match message {
                TtsQueueMessage::Segment(text) => {
                    let speech = speak_text_with_progress_and_control(
                        SpeakTextOptions {
                            text: Some(text),
                            voice: None,
                            model: None,
                            format: Some(tts_settings.tts_format.clone()),
                            mode: Some(tts_settings.tts_mode.clone()),
                            autoplay: Some(true),
                            max_chunk_chars: None,
                            max_parallel_requests: Some(3),
                            first_chunk_leading_silence_ms: Some(
                                tts_settings.first_chunk_leading_silence_ms,
                            ),
                        },
                        &tts_settings,
                        tts_progress.clone(),
                        tts_run_access.clone(),
                    )?;
                    results.push(speech);
                }
                TtsQueueMessage::Finish => break,
            }
        }

        Ok(results)
    });

    let mut chunker = StreamSpeechChunker::default();
    let mut full_text = String::new();
    let mut response_session_id: Option<String> = None;
    let mut run_id: Option<String> = None;
    let mut final_response: Option<Value> = None;
    let mut final_chat_received = false;
    let mut final_chat_received_at: Option<Instant> = None;
    let started_at = Instant::now();

    loop {
        if let Some(run_access) = run_access {
            if let Err(error) = run_access.check_cancelled() {
                if let Some(active_run_id) = run_id.as_deref() {
                    let _ = client.abort_chat(&session_key, active_run_id);
                }
                let _ = tts_sender.send(TtsQueueMessage::Finish);
                let _ = tts_worker.join();
                let _ = client.close();
                return Err(error);
            }
        }

        if final_chat_received && final_response.is_some() {
            break;
        }

        if final_chat_received
            && final_response.is_none()
            && !full_text.trim().is_empty()
            && final_chat_received_at
                .map(|instant| {
                    instant.elapsed()
                        >= Duration::from_millis(OPENCLAW_GATEWAY_FINAL_RESPONSE_GRACE_MS)
                })
                .unwrap_or(false)
        {
            break;
        }

        if started_at.elapsed() > Duration::from_secs(OPENCLAW_REQUEST_TIMEOUT_SECS) {
            let _ = tts_sender.send(TtsQueueMessage::Finish);
            let _ = tts_worker.join();
            let _ = client.close();
            return Err("Timed out waiting for the streamed OpenClaw response.".to_string());
        }

        match client.read_frame()? {
            GatewayRead::Timeout | GatewayRead::Ignore => continue,
            GatewayRead::Closed(reason) => {
                let _ = tts_sender.send(TtsQueueMessage::Finish);
                let _ = tts_worker.join();
                return Err(match reason {
                    Some(reason) => format!("OpenClaw gateway websocket closed: {reason}"),
                    None => "OpenClaw gateway websocket closed before the voice turn finished."
                        .to_string(),
                });
            }
            GatewayRead::Response {
                id,
                ok,
                payload,
                error_message,
            } => {
                if id != chat_request_id {
                    continue;
                }

                if !ok {
                    let _ = tts_sender.send(TtsQueueMessage::Finish);
                    let _ = tts_worker.join();
                    let _ = client.close();
                    return Err(error_message.unwrap_or_else(|| {
                        "OpenClaw gateway request failed without an error message.".to_string()
                    }));
                }

                let status = payload
                    .get("status")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .unwrap_or_default();

                if is_gateway_chat_request_ack_status(status) {
                    if run_id.is_none() {
                        run_id = payload
                            .get("runId")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string);
                    }
                    emit_stream_event(
                        app,
                        OpenClawStreamEvent {
                            phase: "status".to_string(),
                            transport: "gateway_ws".to_string(),
                            detail: Some(
                                "OpenClaw accepted the request and started generating a reply."
                                    .to_string(),
                            ),
                            delta: None,
                            accumulated_text: Some(full_text.clone()),
                            agent_id: agent_id.clone(),
                            session_key: Some(session_key.clone()),
                            requested_session_id: requested_session_id.clone(),
                            response_session_id: response_session_id.clone(),
                            run_id: run_id.clone(),
                            tool_name: None,
                            tool_phase: None,
                            timestamp_ms: system_time_ms(),
                        },
                    );
                    if let Some(run_access) = run_access {
                        run_access.update_phase("openclaw_streaming");
                    }
                    continue;
                }

                if status.eq_ignore_ascii_case("error") {
                    let _ = tts_sender.send(TtsQueueMessage::Finish);
                    let _ = tts_worker.join();
                    let _ = client.close();
                    return Err(extract_gateway_error_detail(&payload).unwrap_or_else(|| {
                        "OpenClaw reported a gateway error for the assistant voice turn."
                            .to_string()
                    }));
                }

                if status.eq_ignore_ascii_case("timeout") {
                    let _ = tts_sender.send(TtsQueueMessage::Finish);
                    let _ = tts_worker.join();
                    let _ = client.close();
                    return Err(extract_gateway_error_detail(&payload).unwrap_or_else(|| {
                        "OpenClaw timed out before the assistant voice turn completed."
                            .to_string()
                    }));
                }

                if response_session_id.is_none() {
                    response_session_id = extract_response_session_id(&payload);
                }
                if run_id.is_none() {
                    run_id = payload
                        .get("runId")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string);
                }
                if let Some(text) = extract_response_text(&payload) {
                    let text = sanitize_assistant_reply_text(&text);
                    if full_text.trim().is_empty() {
                        full_text = text;
                    }
                    final_chat_received = true;
                    final_chat_received_at = Some(Instant::now());
                }
                final_response = Some(payload);
            }
            GatewayRead::Event { event, payload } => {
                if event == "chat" {
                    let payload_session_key = payload
                        .get("sessionKey")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default();
                    if payload_session_key != session_key {
                        continue;
                    }

                    if response_session_id.is_none() {
                        response_session_id = payload
                            .get("sessionId")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string);
                    }

                    if run_id.is_none() {
                        run_id = payload
                            .get("runId")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string);
                    }

                    let state = payload
                        .get("state")
                        .and_then(Value::as_str)
                        .unwrap_or_default();

                    if matches!(state, "delta" | "final") {
                        let next_full_text =
                            extract_chat_message_text(payload.get("message").unwrap_or(&Value::Null));
                        if next_full_text.chars().count() > full_text.chars().count() {
                            let delta = next_full_text
                                .chars()
                                .skip(full_text.chars().count())
                                .collect::<String>();
                            full_text = next_full_text;

                            if !delta.trim().is_empty() {
                                emit_stream_event(
                                    app,
                                    OpenClawStreamEvent {
                                        phase: "text_delta".to_string(),
                                        transport: "gateway_ws".to_string(),
                                        detail: None,
                                        delta: Some(delta.clone()),
                                        accumulated_text: Some(full_text.clone()),
                                        agent_id: agent_id.clone(),
                                        session_key: Some(session_key.clone()),
                                        requested_session_id: requested_session_id.clone(),
                                        response_session_id: response_session_id.clone(),
                                        run_id: run_id.clone(),
                                        tool_name: None,
                                        tool_phase: None,
                                        timestamp_ms: system_time_ms(),
                                    },
                                );

                                for segment in chunker.push_delta(&delta) {
                                    tts_sender
                                        .send(TtsQueueMessage::Segment(segment))
                                        .map_err(|err| {
                                            format!(
                                                "Failed to queue streamed TTS segment: {err}"
                                            )
                                        })?;
                                }
                            }
                        } else if state == "final" && full_text.trim().is_empty() {
                            full_text = next_full_text;
                        }
                    }

                    if state == "final" {
                        final_chat_received = true;
                        final_chat_received_at = Some(Instant::now());
                        emit_stream_event(
                            app,
                            OpenClawStreamEvent {
                                phase: "status".to_string(),
                                transport: "gateway_ws".to_string(),
                                detail: Some(
                                    "OpenClaw finished streaming the assistant reply.".to_string(),
                                ),
                                delta: None,
                                accumulated_text: Some(full_text.clone()),
                                agent_id: agent_id.clone(),
                                session_key: Some(session_key.clone()),
                                requested_session_id: requested_session_id.clone(),
                                response_session_id: response_session_id.clone(),
                                run_id: run_id.clone(),
                                tool_name: None,
                                tool_phase: None,
                                timestamp_ms: system_time_ms(),
                            },
                        );
                    } else if state == "aborted" {
                        let _ = tts_sender.send(TtsQueueMessage::Finish);
                        let _ = tts_worker.join();
                        let _ = client.close();
                        return Err("OpenClaw aborted the assistant voice turn.".to_string());
                    } else if state == "error" {
                        let _ = tts_sender.send(TtsQueueMessage::Finish);
                        let _ = tts_worker.join();
                        let _ = client.close();
                        let detail = payload
                            .get("errorMessage")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .unwrap_or("OpenClaw reported an unknown streaming error.");
                        return Err(detail.to_string());
                    }

                    continue;
                }

                if event == "session.message" {
                    let payload_session_key = payload
                        .get("sessionKey")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default();
                    if payload_session_key != session_key {
                        continue;
                    }

                    if response_session_id.is_none() {
                        response_session_id = payload
                            .get("sessionId")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string);
                    }

                    let Some(message) = payload.get("message") else {
                        continue;
                    };
                    if !is_assistant_transcript_message(message) {
                        continue;
                    }

                    let terminal_message = is_terminal_assistant_transcript_message(message);

                    let next_full_text = extract_chat_message_text(message);
                    if next_full_text.chars().count() > full_text.chars().count() {
                        let delta = next_full_text
                            .chars()
                            .skip(full_text.chars().count())
                            .collect::<String>();
                        full_text = next_full_text;

                        if !delta.trim().is_empty() {
                            emit_stream_event(
                                app,
                                OpenClawStreamEvent {
                                    phase: "text_delta".to_string(),
                                    transport: "gateway_ws".to_string(),
                                    detail: Some(
                                        "Assistant transcript appended to the session."
                                            .to_string(),
                                    ),
                                    delta: Some(delta.clone()),
                                    accumulated_text: Some(full_text.clone()),
                                    agent_id: agent_id.clone(),
                                    session_key: Some(session_key.clone()),
                                    requested_session_id: requested_session_id.clone(),
                                    response_session_id: response_session_id.clone(),
                                    run_id: run_id.clone(),
                                    tool_name: None,
                                    tool_phase: None,
                                    timestamp_ms: system_time_ms(),
                                },
                            );

                            for segment in chunker.push_delta(&delta) {
                                tts_sender
                                    .send(TtsQueueMessage::Segment(segment))
                                    .map_err(|err| {
                                        format!(
                                            "Failed to queue streamed TTS segment: {err}"
                                        )
                                    })?;
                            }
                        }
                    }

                    if terminal_message && !full_text.trim().is_empty() {
                        final_chat_received = true;
                        final_chat_received_at = Some(Instant::now());
                        emit_stream_event(
                            app,
                            OpenClawStreamEvent {
                                phase: "status".to_string(),
                                transport: "gateway_ws".to_string(),
                                detail: Some(
                                    "OpenClaw appended the final assistant reply to the session."
                                        .to_string(),
                                ),
                                delta: None,
                                accumulated_text: Some(full_text.clone()),
                                agent_id: agent_id.clone(),
                                session_key: Some(session_key.clone()),
                                requested_session_id: requested_session_id.clone(),
                                response_session_id: response_session_id.clone(),
                                run_id: run_id.clone(),
                                tool_name: None,
                                tool_phase: None,
                                timestamp_ms: system_time_ms(),
                            },
                        );
                    }

                    continue;
                }

                if event == "agent" {
                    let payload_session_key = payload
                        .get("sessionKey")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default();
                    if payload_session_key != session_key {
                        continue;
                    }

                    emit_stream_event(
                        app,
                        OpenClawStreamEvent {
                            phase: "tool".to_string(),
                            transport: "gateway_ws".to_string(),
                            detail: payload
                                .get("data")
                                .and_then(|value| value.get("partialResult"))
                                .map(compact_json_value)
                                .or_else(|| {
                                    payload
                                        .get("data")
                                        .and_then(|value| value.get("result"))
                                        .map(compact_json_value)
                                }),
                            delta: None,
                            accumulated_text: Some(full_text.clone()),
                            agent_id: agent_id.clone(),
                            session_key: Some(session_key.clone()),
                            requested_session_id: requested_session_id.clone(),
                            response_session_id: response_session_id.clone(),
                            run_id: run_id.clone(),
                            tool_name: payload
                                .get("data")
                                .and_then(|value| value.get("name"))
                                .and_then(Value::as_str)
                                .map(str::to_string),
                            tool_phase: payload
                                .get("data")
                                .and_then(|value| value.get("phase"))
                                .and_then(Value::as_str)
                                .map(str::to_string),
                            timestamp_ms: system_time_ms(),
                        },
                    );
                }
            }
        }
    }

    for segment in chunker.finish() {
        tts_sender
            .send(TtsQueueMessage::Segment(segment))
            .map_err(|err| format!("Failed to queue the final streamed TTS segment: {err}"))?;
    }
    tts_sender
        .send(TtsQueueMessage::Finish)
        .map_err(|err| format!("Failed to finalize the streamed TTS queue: {err}"))?;

    let speech_results = tts_worker
        .join()
        .map_err(|_| "The streamed TTS worker panicked.".to_string())??;

    if full_text.trim().is_empty() {
        if let Some(payload) = final_response.as_ref() {
            if let Some(text) = extract_response_text(payload) {
                full_text = sanitize_assistant_reply_text(&text);
            }
        }
    }

    if full_text.trim().is_empty() {
        for attempt in 0..3 {
            if attempt > 0 {
                thread::sleep(Duration::from_millis(OPENCLAW_GATEWAY_HISTORY_RETRY_MS));
            }

            if let Ok(history_payload) = client.chat_history(&session_key, 8) {
                if response_session_id.is_none() {
                    response_session_id = extract_response_session_id(&history_payload);
                }
                if let Some(text) = extract_latest_assistant_text_from_chat_history(&history_payload)
                {
                    full_text = text;
                    break;
                }
            }
        }
    }

    let _ = client.close();

    if full_text.trim().is_empty() {
        return Err("OpenClaw finished without returning any assistant text.".to_string());
    }

    let speech = aggregate_streamed_speech_results(speech_results)?;

    Ok((
        OpenClawBridgeResult {
            text: full_text,
            endpoint_url: gateway_config.url,
            transport: "gateway_ws".to_string(),
            agent_id,
            requested_session_id,
            response_session_id,
            session_key: Some(session_key),
            run_id,
        },
        speech,
    ))
}

fn speak_full_response(
    text: &str,
    settings: &AppSettings,
    run_access: Option<&RunAccess>,
    progress: Option<ProgressCallback>,
) -> Result<SpeakTextResult, String> {
    let text = sanitize_assistant_reply_text(text);
    speak_text_with_progress_and_control(
        SpeakTextOptions {
            text: Some(text),
            voice: None,
            model: None,
            format: Some(settings.tts_format.clone()),
            mode: Some(settings.tts_mode.clone()),
            autoplay: Some(true),
            max_chunk_chars: None,
            max_parallel_requests: Some(3),
            first_chunk_leading_silence_ms: Some(settings.first_chunk_leading_silence_ms),
        },
        settings,
        progress,
        run_access.cloned(),
    )
}

fn aggregate_streamed_speech_results(results: Vec<SpeakTextResult>) -> Result<SpeakTextResult, String> {
    let mut iter = results.into_iter();
    let mut aggregate = iter
        .next()
        .ok_or_else(|| "The streamed TTS pipeline did not synthesize any speech.".to_string())?;

    for result in iter {
        aggregate.file_path = result.file_path;
        aggregate.output_directory = result.output_directory;
        aggregate.bytes_written += result.bytes_written;
        aggregate.chunk_count += result.chunk_count;
        aggregate.first_audio_received_at_ms = match (
            aggregate.first_audio_received_at_ms,
            result.first_audio_received_at_ms,
        ) {
            (Some(left), Some(right)) => Some(left.min(right)),
            (None, value) => value,
            (value, None) => value,
        };
        aggregate.first_audio_playback_started_at_ms = match (
            aggregate.first_audio_playback_started_at_ms,
            result.first_audio_playback_started_at_ms,
        ) {
            (Some(left), Some(right)) => Some(left.min(right)),
            (None, value) => value,
            (value, None) => value,
        };
        if aggregate.start_latency_ms.is_none() {
            aggregate.start_latency_ms = result.start_latency_ms;
        }
    }

    Ok(aggregate)
}

fn load_local_gateway_config() -> Result<OpenClawGatewayConfig, String> {
    let path = openclaw_config_path()?;
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read OpenClaw config at {}: {error}", path.display()))?;
    let parsed: OpenClawLocalConfigFile = serde_json::from_str(&raw)
        .map_err(|error| format!("Failed to parse OpenClaw config at {}: {error}", path.display()))?;

    let gateway = parsed.gateway.unwrap_or(OpenClawLocalGatewayConfigFile {
        port: Some(OPENCLAW_DEFAULT_GATEWAY_PORT),
        auth: None,
    });
    let auth = gateway.auth.unwrap_or(OpenClawLocalGatewayAuthFile {
        mode: None,
        token: None,
        password: None,
    });
    let url = env::var("OPENCLAW_GATEWAY_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("ws://127.0.0.1:{}", gateway.port.unwrap_or(OPENCLAW_DEFAULT_GATEWAY_PORT)));

    let agent_ids = parsed
        .agents
        .and_then(|agents| agents.list)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|record| {
            record
                .id
                .map(|id| id.trim().to_string())
                .filter(|id| !id.is_empty())
        })
        .collect::<Vec<_>>();

    Ok(OpenClawGatewayConfig {
        url,
        auth_mode: auth.mode.unwrap_or_else(|| "none".to_string()),
        token: auth.token.map(|value| value.trim().to_string()).filter(|value| !value.is_empty()),
        password: auth
            .password
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        agent_ids,
    })
}

fn openclaw_config_path() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("OPENCLAW_CONFIG_PATH") {
        let trimmed = path.to_string_lossy().trim().to_string();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    if let Some(home) = env::var_os("OPENCLAW_HOME") {
        let base = PathBuf::from(home);
        if !base.as_os_str().is_empty() {
            return Ok(base.join("openclaw.json"));
        }
    }

    if let Some(home) = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")) {
        let base = PathBuf::from(home);
        if !base.as_os_str().is_empty() {
            return Ok(base.join(".openclaw").join("openclaw.json"));
        }
    }

    Err("Could not locate the local OpenClaw config file.".to_string())
}

fn openclaw_state_dir() -> Result<PathBuf, String> {
    if let Some(home) = env::var_os("OPENCLAW_HOME") {
        let base = PathBuf::from(home);
        if !base.as_os_str().is_empty() {
            return Ok(base);
        }
    }

    let config_path = openclaw_config_path()?;
    config_path
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Could not resolve the local OpenClaw state directory.".to_string())
}

fn openclaw_device_identity_path() -> Result<PathBuf, String> {
    Ok(openclaw_state_dir()?.join("identity").join("device.json"))
}

fn openclaw_client_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        env::consts::OS
    }
}

fn openclaw_client_device_family() -> Option<&'static str> {
    if cfg!(target_os = "windows") {
        Some("Windows")
    } else if cfg!(target_os = "macos") {
        Some("macOS")
    } else if cfg!(target_os = "linux") {
        Some("Linux")
    } else {
        None
    }
}

fn base64_url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

fn normalize_device_metadata_for_auth(value: Option<&str>) -> String {
    value
        .unwrap_or_default()
        .trim()
        .chars()
        .map(|ch| ch.to_ascii_lowercase())
        .collect::<String>()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn verifying_key_from_public_pem(public_key_pem: &str) -> Result<VerifyingKey, String> {
    VerifyingKey::from_public_key_pem(public_key_pem)
        .map_err(|error| format!("Failed to parse the stored OpenClaw device public key: {error}"))
}

fn signing_key_from_private_pem(private_key_pem: &str) -> Result<SigningKey, String> {
    SigningKey::from_pkcs8_pem(private_key_pem)
        .map_err(|error| format!("Failed to parse the stored OpenClaw device private key: {error}"))
}

fn device_id_from_verifying_key(verifying_key: &VerifyingKey) -> String {
    sha256_hex(verifying_key.as_bytes())
}

fn build_device_identity_from_keys(
    signing_key: &SigningKey,
    verifying_key: &VerifyingKey,
) -> Result<OpenClawDeviceIdentity, String> {
    let public_key_pem = verifying_key
        .to_public_key_pem(LineEnding::LF)
        .map_err(|error| format!("Failed to encode the OpenClaw device public key: {error}"))?
        .to_string();
    let private_key_pem = signing_key
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|error| format!("Failed to encode the OpenClaw device private key: {error}"))?
        .to_string();

    Ok(OpenClawDeviceIdentity {
        device_id: device_id_from_verifying_key(verifying_key),
        public_key_pem,
        private_key_pem,
    })
}

fn generate_openclaw_device_identity() -> Result<OpenClawDeviceIdentity, String> {
    let signing_key = SigningKey::generate(&mut OsRng);
    let verifying_key = signing_key.verifying_key();
    build_device_identity_from_keys(&signing_key, &verifying_key)
}

fn store_openclaw_device_identity(
    path: &PathBuf,
    identity: &OpenClawDeviceIdentity,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create the OpenClaw identity directory at {}: {error}",
                parent.display()
            )
        })?;
    }

    let payload = OpenClawStoredDeviceIdentity {
        version: OPENCLAW_DEVICE_IDENTITY_VERSION,
        device_id: identity.device_id.clone(),
        public_key_pem: identity.public_key_pem.clone(),
        private_key_pem: identity.private_key_pem.clone(),
        created_at_ms: Some(system_time_ms()),
    };

    let raw = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("Failed to serialize the OpenClaw device identity: {error}"))?;
    fs::write(path, format!("{raw}\n")).map_err(|error| {
        format!(
            "Failed to write the OpenClaw device identity at {}: {error}",
            path.display()
        )
    })
}

fn normalize_or_create_device_identity(
    path: &PathBuf,
    stored: OpenClawStoredDeviceIdentity,
) -> Result<OpenClawDeviceIdentity, String> {
    let signing_key = signing_key_from_private_pem(&stored.private_key_pem)?;
    let verifying_key = verifying_key_from_public_pem(&stored.public_key_pem)
        .unwrap_or_else(|_| signing_key.verifying_key());
    let normalized = build_device_identity_from_keys(&signing_key, &verifying_key)?;
    let needs_rewrite = stored.version != OPENCLAW_DEVICE_IDENTITY_VERSION
        || stored.device_id != normalized.device_id
        || stored.public_key_pem != normalized.public_key_pem
        || stored.private_key_pem != normalized.private_key_pem;

    if needs_rewrite {
        store_openclaw_device_identity(path, &normalized)?;
    }

    Ok(normalized)
}

fn load_or_create_openclaw_device_identity() -> Result<OpenClawDeviceIdentity, String> {
    let path = openclaw_device_identity_path()?;
    match fs::read_to_string(&path) {
        Ok(raw) => {
            let stored: OpenClawStoredDeviceIdentity = serde_json::from_str(&raw).map_err(|error| {
                format!(
                    "Failed to parse the OpenClaw device identity at {}: {error}",
                    path.display()
                )
            })?;
            normalize_or_create_device_identity(&path, stored)
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let identity = generate_openclaw_device_identity()?;
            store_openclaw_device_identity(&path, &identity)?;
            Ok(identity)
        }
        Err(error) => Err(format!(
            "Failed to read the OpenClaw device identity at {}: {error}",
            path.display()
        )),
    }
}

fn public_key_raw_base64_url_from_pem(public_key_pem: &str) -> Result<String, String> {
    let verifying_key = verifying_key_from_public_pem(public_key_pem)?;
    Ok(base64_url_encode(&verifying_key.to_bytes()))
}

fn sign_device_payload(private_key_pem: &str, payload: &str) -> Result<String, String> {
    let signing_key = signing_key_from_private_pem(private_key_pem)?;
    Ok(base64_url_encode(
        &signing_key.sign(payload.as_bytes()).to_bytes(),
    ))
}

fn build_device_auth_payload_v3(
    device_id: &str,
    client_id: &str,
    client_mode: &str,
    role: &str,
    scopes: &[&str],
    signed_at_ms: u64,
    token: Option<&str>,
    nonce: &str,
    platform: &str,
    device_family: Option<&str>,
) -> String {
    let normalized_platform = normalize_device_metadata_for_auth(Some(platform));
    let normalized_device_family = normalize_device_metadata_for_auth(device_family);
    [
        "v3".to_string(),
        device_id.to_string(),
        client_id.to_string(),
        client_mode.to_string(),
        role.to_string(),
        scopes.join(","),
        signed_at_ms.to_string(),
        token.unwrap_or_default().to_string(),
        nonce.to_string(),
        normalized_platform,
        normalized_device_family,
    ]
    .join("|")
}

fn normalize_session_key_segment(value: &str) -> String {
    let mut normalized = String::new();
    let mut last_was_dash = false;

    for ch in value.trim().chars() {
        let lowered = ch.to_ascii_lowercase();
        if lowered.is_ascii_alphanumeric() || lowered == '_' {
            normalized.push(lowered);
            last_was_dash = false;
        } else if (lowered == '-' || lowered == ' ' || lowered == ':') && !last_was_dash {
            normalized.push('-');
            last_was_dash = true;
        }
    }

    normalized.trim_matches('-').to_string()
}

fn canonical_gateway_session_key(agent_id: &str, session_hint: &str) -> String {
    let normalized_agent_id = normalize_session_key_segment(agent_id);
    let normalized_session_hint = normalize_session_key_segment(session_hint);
    let session_segment = if normalized_session_hint.is_empty() {
        "main".to_string()
    } else {
        normalized_session_hint
    };

    format!("agent:{normalized_agent_id}:{session_segment}")
}

fn is_missing_session_error(error: &str) -> bool {
    let lowered = error.trim().to_ascii_lowercase();
    lowered.contains("no session found")
        || lowered.contains("unknown session")
        || lowered.contains("unable to resolve session")
}

fn resolve_gateway_agent_id(
    options: &OpenClawVoiceTurnOptions,
    settings: &AppSettings,
    gateway_config: &OpenClawGatewayConfig,
) -> Option<String> {
    if let Some(explicit) = first_non_empty(
        options.agent_id.as_deref(),
        settings.openclaw_agent_id.as_str(),
    ) {
        return Some(explicit);
    }

    if gateway_config
        .agent_ids
        .iter()
        .any(|id| id == OPENCLAW_PREFERRED_AGENT_ID)
    {
        return Some(OPENCLAW_PREFERRED_AGENT_ID.to_string());
    }

    if gateway_config
        .agent_ids
        .iter()
        .any(|id| id == OPENCLAW_DEFAULT_AGENT_ID)
    {
        return Some(OPENCLAW_DEFAULT_AGENT_ID.to_string());
    }

    gateway_config
        .agent_ids
        .first()
        .cloned()
        .or_else(|| Some(OPENCLAW_DEFAULT_AGENT_ID.to_string()))
}

fn resolve_gateway_session_key(
    client: &mut OpenClawGatewayClient,
    requested_session_id: Option<&str>,
    agent_id: Option<&str>,
) -> Result<String, String> {
    let resolved_agent_id = agent_id.unwrap_or(OPENCLAW_DEFAULT_AGENT_ID);

    match requested_session_id.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) if value.starts_with("agent:") => client
            .resolve_session_key(value)
            .or_else(|error| {
                if is_missing_session_error(&error) {
                    client.create_session(resolved_agent_id, Some(value), None)
                } else {
                    Err(error)
                }
            }),
        Some(value) if looks_like_session_id(value) => client.resolve_session_id(value),
        Some(value) => client.resolve_session_label(resolved_agent_id, value).or_else(|error| {
            if is_missing_session_error(&error) {
                let key = canonical_gateway_session_key(resolved_agent_id, value);
                client.create_session(resolved_agent_id, Some(&key), Some(value))
            } else {
                Err(error)
            }
        }),
        None => {
            let key = canonical_gateway_session_key(
                resolved_agent_id,
                OPENCLAW_DEFAULT_SESSION_LABEL,
            );
            client
                .resolve_session_key(&key)
                .or_else(|error| {
                    if is_missing_session_error(&error) {
                        client.create_session(
                            resolved_agent_id,
                            Some(&key),
                            Some(OPENCLAW_DEFAULT_SESSION_LABEL),
                        )
                    } else {
                        Err(error)
                    }
                })
        }
    }
}

fn looks_like_session_id(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.len() == 36
        && trimmed
            .chars()
            .enumerate()
            .all(|(index, ch)| match index {
                8 | 13 | 18 | 23 => ch == '-',
                _ => ch.is_ascii_hexdigit(),
            })
}

fn emit_stream_event(app: &AppHandle, event: OpenClawStreamEvent) {
    let _ = app.emit(OPENCLAW_STREAM_EVENT, event);
}

fn wrap_stream_tts_progress(progress: Option<ProgressCallback>) -> Option<ProgressCallback> {
    let progress = progress?;
    let pipeline_started = Arc::new(AtomicBool::new(false));
    let first_audio_received = Arc::new(AtomicBool::new(false));
    let first_audio_playback_started = Arc::new(AtomicBool::new(false));

    Some(Arc::new(move |update: TtsProgress| {
        let should_forward = match &update {
            TtsProgress::PipelineStarted { .. } => !pipeline_started.swap(true, Ordering::SeqCst),
            TtsProgress::FirstAudioReceived { .. } => {
                !first_audio_received.swap(true, Ordering::SeqCst)
            }
            TtsProgress::FirstAudioPlaybackStarted { .. } => {
                !first_audio_playback_started.swap(true, Ordering::SeqCst)
            }
            _ => true,
        };

        if should_forward {
            progress(update);
        }
    }))
}

#[derive(Default)]
struct StreamSpeechChunker {
    buffer: String,
}

impl StreamSpeechChunker {
    fn push_delta(&mut self, delta: &str) -> Vec<String> {
        self.buffer.push_str(delta);
        self.drain_ready_segments(false)
    }

    fn finish(&mut self) -> Vec<String> {
        self.drain_ready_segments(true)
    }

    fn drain_ready_segments(&mut self, force_all: bool) -> Vec<String> {
        let mut segments = Vec::new();

        loop {
            let char_count = self.buffer.chars().count();
            if char_count == 0 {
                break;
            }

            let split_at = if force_all {
                Some(self.buffer.len())
            } else if char_count >= STREAM_CHUNK_FORCE_CHARS {
                find_strong_boundary(&self.buffer)
                    .or_else(|| find_soft_boundary(&self.buffer))
                    .or_else(|| prefix_at_char_limit(&self.buffer, STREAM_CHUNK_FORCE_CHARS))
            } else if char_count >= STREAM_CHUNK_MIN_CHARS {
                find_strong_boundary(&self.buffer)
            } else {
                None
            };

            let Some(split_at) = split_at else {
                break;
            };

            let segment = self.buffer[..split_at].trim().to_string();
            self.buffer = self.buffer[split_at..].trim_start().to_string();
            if !segment.is_empty() {
                segments.push(segment);
            }

            if !force_all && self.buffer.chars().count() < STREAM_CHUNK_MIN_CHARS {
                break;
            }
        }

        segments
    }
}

fn find_strong_boundary(value: &str) -> Option<usize> {
    value
        .char_indices()
        .rev()
        .find_map(|(index, ch)| match ch {
            '.' | '!' | '?' | '\n' => Some(index + ch.len_utf8()),
            _ => None,
        })
}

fn find_soft_boundary(value: &str) -> Option<usize> {
    value
        .char_indices()
        .rev()
        .find_map(|(index, ch)| match ch {
            ',' | ';' | ':' | ')' | ']' | ' ' => Some(index + ch.len_utf8()),
            _ => None,
        })
}

fn prefix_at_char_limit(value: &str, max_chars: usize) -> Option<usize> {
    let mut count = 0usize;
    for (index, ch) in value.char_indices() {
        count += 1;
        if count >= max_chars {
            return Some(index + ch.len_utf8());
        }
    }
    None
}

fn extract_chat_message_text(message: &Value) -> String {
    sanitize_assistant_reply_text(&extract_response_text(message).unwrap_or_default())
}

fn sanitize_assistant_reply_text(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut index = 0usize;
    let mut sanitized = String::with_capacity(value.len());

    while index < bytes.len() {
        if bytes[index] == b'[' && index + 1 < bytes.len() && bytes[index + 1] == b'[' {
            let mut probe = index + 2;
            let mut matched = false;

            while probe + 1 < bytes.len() {
                if bytes[probe] == b']' && bytes[probe + 1] == b']' {
                    matched = probe > index + 2;
                    break;
                }

                let valid = bytes[probe].is_ascii_lowercase()
                    || bytes[probe].is_ascii_digit()
                    || matches!(bytes[probe], b'_' | b':' | b'-');
                if !valid {
                    matched = false;
                    break;
                }

                probe += 1;
            }

            if matched {
                index = probe + 2;
                while index < bytes.len() && bytes[index].is_ascii_whitespace() {
                    index += 1;
                }
                continue;
            }
        }

        let ch = value[index..].chars().next().unwrap_or_default();
        sanitized.push(ch);
        index += ch.len_utf8();
    }

    sanitized.trim().to_string()
}

fn is_assistant_transcript_message(message: &Value) -> bool {
    message
        .get("role")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|role| role.eq_ignore_ascii_case("assistant"))
}

fn is_terminal_assistant_transcript_message(message: &Value) -> bool {
    if !is_assistant_transcript_message(message) {
        return false;
    }

    if message
        .get("stopReason")
        .and_then(Value::as_str)
        .map(str::trim)
        .is_some_and(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "stop" | "end_turn" | "endturn" | "final" | "completed"
            )
        })
    {
        return true;
    }

    message
        .get("content")
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().any(|item| {
                item.get("textSignature")
                    .and_then(Value::as_str)
                    .and_then(|signature| serde_json::from_str::<Value>(signature).ok())
                    .and_then(|signature| signature.get("phase").and_then(Value::as_str).map(str::trim).map(str::to_string))
                    .is_some_and(|phase| phase.eq_ignore_ascii_case("final_answer"))
            })
        })
}

fn is_gateway_chat_request_ack_status(status: &str) -> bool {
    matches!(status, "accepted" | "started" | "in_flight" | "queued")
}

fn extract_gateway_error_detail(payload: &Value) -> Option<String> {
    for path in [
        &["error", "message"][..],
        &["errorMessage"][..],
        &["error"][..],
        &["message"][..],
        &["detail"][..],
    ] {
        if let Some(value) = value_at_path(payload, path) {
            if let Some(text) = value_to_text(value) {
                return Some(text);
            }
        }
    }

    None
}

fn extract_latest_assistant_text_from_chat_history(payload: &Value) -> Option<String> {
    payload
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages
                .iter()
                .rev()
                .find_map(|message| {
                    if !is_terminal_assistant_transcript_message(message) {
                        return None;
                    }

                    let text = extract_chat_message_text(message);
                    if text.trim().is_empty() {
                        None
                    } else {
                        Some(text)
                    }
                })
                .or_else(|| messages.iter().rev().find_map(|message| {
                if !is_assistant_transcript_message(message) {
                    return None;
                }

                let text = extract_chat_message_text(message);
                if text.trim().is_empty() {
                    None
                } else {
                    Some(text)
                }
            }))
        })
}

fn compact_json_value(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return compact_response_body(text);
    }

    serde_json::to_string(value)
        .map(|text| compact_response_body(&text))
        .unwrap_or_else(|_| "<unserializable-json>".to_string())
}

struct OpenClawGatewayClient {
    socket: OpenClawSocket,
}

impl OpenClawGatewayClient {
    fn connect(config: &OpenClawGatewayConfig) -> Result<Self, String> {
        let (mut socket, _) = tungstenite::connect(config.url.as_str())
            .map_err(|error| format!("Failed to connect to the OpenClaw gateway websocket: {error}"))?;
        configure_gateway_socket(&mut socket)?;

        let connect_started_at = Instant::now();
        let mut connect_nonce: Option<String> = None;
        while connect_started_at.elapsed()
            < Duration::from_millis(OPENCLAW_GATEWAY_CONNECT_TIMEOUT_MS)
        {
            match read_gateway_frame(&mut socket)? {
                GatewayRead::Event { event, payload } if event == "connect.challenge" => {
                    let nonce = payload
                        .get("nonce")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .unwrap_or_default();
                    if nonce.is_empty() {
                        let _ = socket.close(None);
                        return Err("OpenClaw gateway connect challenge did not include a nonce."
                            .to_string());
                    }
                    connect_nonce = Some(nonce.to_string());
                    break;
                }
                GatewayRead::Timeout | GatewayRead::Ignore => continue,
                GatewayRead::Closed(reason) => {
                    return Err(match reason {
                        Some(reason) => format!(
                            "OpenClaw gateway websocket closed during the handshake: {reason}"
                        ),
                        None => {
                            "OpenClaw gateway websocket closed during the handshake.".to_string()
                        }
                    })
                }
                GatewayRead::Response { .. } | GatewayRead::Event { .. } => continue,
            }
        }

        let Some(connect_nonce) = connect_nonce else {
            let _ = socket.close(None);
            return Err("Timed out waiting for the OpenClaw gateway handshake challenge.".to_string());
        };

        let platform = openclaw_client_platform();
        let device_family = openclaw_client_device_family();
        let normalized_device_family = normalize_device_metadata_for_auth(device_family);
        let signed_at_ms = system_time_ms();
        let device_identity = load_or_create_openclaw_device_identity()?;
        let signature_token = match config.auth_mode.as_str() {
            "token" => config.token.as_deref(),
            _ => None,
        };
        let device_payload = build_device_auth_payload_v3(
            &device_identity.device_id,
            OPENCLAW_CLIENT_ID,
            OPENCLAW_CLIENT_MODE,
            "operator",
            OPENCLAW_OPERATOR_SCOPES,
            signed_at_ms,
            signature_token,
            &connect_nonce,
            platform,
            device_family,
        );
        let device_signature =
            sign_device_payload(&device_identity.private_key_pem, &device_payload)?;
        let device_public_key =
            public_key_raw_base64_url_from_pem(&device_identity.public_key_pem)?;

        let connect_id = next_gateway_request_id();
        let mut connect_params = json!({
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id": OPENCLAW_CLIENT_ID,
                "displayName": OPENCLAW_CLIENT_DISPLAY_NAME,
                "version": env!("CARGO_PKG_VERSION"),
                "platform": platform,
                "mode": OPENCLAW_CLIENT_MODE,
            },
            "caps": [],
            "role": "operator",
            "scopes": OPENCLAW_OPERATOR_SCOPES,
            "device": {
                "id": device_identity.device_id,
                "publicKey": device_public_key,
                "signature": device_signature,
                "signedAt": signed_at_ms,
                "nonce": connect_nonce,
            },
        });
        if let Some(device_family) = device_family {
            connect_params["client"]["deviceFamily"] = json!(
                if normalized_device_family.is_empty() {
                    device_family
                } else {
                    normalized_device_family.as_str()
                }
            );
        }

        let auth = match config.auth_mode.as_str() {
            "token" => config.token.as_ref().map(|token| json!({ "token": token })),
            "password" => config.password.as_ref().map(|password| json!({ "password": password })),
            _ => None,
        };
        if let Some(auth) = auth {
            connect_params["auth"] = auth;
        }

        send_gateway_json(
            &mut socket,
            json!({
                "type": "req",
                "id": connect_id,
                "method": "connect",
                "params": connect_params,
            }),
        )?;

        let mut client = Self { socket };
        let _ = client.wait_for_response(
            &connect_id,
            false,
            Duration::from_secs(OPENCLAW_CONNECT_TIMEOUT_SECS),
        )?;
        Ok(client)
    }

    fn send_request(&mut self, method: &str, params: Value) -> Result<String, String> {
        let id = next_gateway_request_id();
        send_gateway_json(
            &mut self.socket,
            json!({
                "type": "req",
                "id": id,
                "method": method,
                "params": params,
            }),
        )?;
        Ok(id)
    }

    fn read_frame(&mut self) -> Result<GatewayRead, String> {
        read_gateway_frame(&mut self.socket)
    }

    fn resolve_session_id(&mut self, session_id: &str) -> Result<String, String> {
        let request_id = self.send_request(
            "sessions.resolve",
            json!({
                "sessionId": session_id,
            }),
        )?;
        self.wait_for_response(
            &request_id,
            false,
            Duration::from_secs(OPENCLAW_CONNECT_TIMEOUT_SECS),
        )
        .and_then(|payload| {
            payload
                .get("key")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    "OpenClaw sessions.resolve did not return a canonical session key."
                        .to_string()
                })
        })
    }

    fn resolve_session_key(&mut self, key: &str) -> Result<String, String> {
        let request_id = self.send_request(
            "sessions.resolve",
            json!({
                "key": key,
            }),
        )?;
        self.wait_for_response(
            &request_id,
            false,
            Duration::from_secs(OPENCLAW_CONNECT_TIMEOUT_SECS),
        )
        .and_then(|payload| {
            payload
                .get("key")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    "OpenClaw sessions.resolve did not return a canonical session key."
                        .to_string()
                })
        })
    }

    fn resolve_session_label(&mut self, agent_id: &str, label: &str) -> Result<String, String> {
        let request_id = self.send_request(
            "sessions.resolve",
            json!({
                "label": label,
                "agentId": agent_id,
            }),
        )?;
        self.wait_for_response(
            &request_id,
            false,
            Duration::from_secs(OPENCLAW_CONNECT_TIMEOUT_SECS),
        )
        .and_then(|payload| {
            payload
                .get("key")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    "OpenClaw sessions.resolve did not return a canonical session key."
                        .to_string()
                })
        })
    }

    fn create_session(
        &mut self,
        agent_id: &str,
        key: Option<&str>,
        label: Option<&str>,
    ) -> Result<String, String> {
        let mut params = json!({
            "agentId": agent_id,
        });
        if let Some(key) = key.map(str::trim).filter(|value| !value.is_empty()) {
            params["key"] = json!(key);
        }
        if let Some(label) = label.map(str::trim).filter(|value| !value.is_empty()) {
            params["label"] = json!(label);
        }

        let request_id = self.send_request("sessions.create", params)?;
        self.wait_for_response(
            &request_id,
            false,
            Duration::from_secs(OPENCLAW_CONNECT_TIMEOUT_SECS),
        )
        .and_then(|payload| {
            payload
                .get("key")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    "OpenClaw sessions.create did not return a canonical session key."
                        .to_string()
                })
        })
    }

    fn subscribe_session_messages(&mut self, session_key: &str) -> Result<String, String> {
        let request_id = self.send_request(
            "sessions.messages.subscribe",
            json!({
                "key": session_key,
            }),
        )?;
        self.wait_for_response(
            &request_id,
            false,
            Duration::from_secs(OPENCLAW_CONNECT_TIMEOUT_SECS),
        )
        .and_then(|payload| {
            payload
                .get("key")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .ok_or_else(|| {
                    "OpenClaw sessions.messages.subscribe did not return a canonical session key."
                        .to_string()
                })
        })
    }

    fn chat_history(&mut self, session_key: &str, limit: usize) -> Result<Value, String> {
        let request_id = self.send_request(
            "chat.history",
            json!({
                "sessionKey": session_key,
                "limit": limit,
            }),
        )?;
        self.wait_for_response(
            &request_id,
            false,
            Duration::from_secs(OPENCLAW_CONNECT_TIMEOUT_SECS),
        )
    }

    fn abort_chat(&mut self, session_key: &str, run_id: &str) -> Result<(), String> {
        let request_id = self.send_request(
            "chat.abort",
            json!({
                "sessionKey": session_key,
                "runId": run_id,
            }),
        )?;
        let _ = self.wait_for_response(
            &request_id,
            false,
            Duration::from_secs(OPENCLAW_CONNECT_TIMEOUT_SECS),
        )?;
        Ok(())
    }

    fn wait_for_response(
        &mut self,
        request_id: &str,
        expect_final: bool,
        timeout: Duration,
    ) -> Result<Value, String> {
        let started_at = Instant::now();
        loop {
            if started_at.elapsed() > timeout {
                return Err(format!(
                    "Timed out waiting for the OpenClaw gateway response to request {request_id}."
                ));
            }

            match self.read_frame()? {
                GatewayRead::Timeout | GatewayRead::Ignore => continue,
                GatewayRead::Closed(reason) => {
                    return Err(match reason {
                        Some(reason) => format!("OpenClaw gateway websocket closed: {reason}"),
                        None => {
                            "OpenClaw gateway websocket closed while waiting for a response."
                                .to_string()
                        }
                    })
                }
                GatewayRead::Event { .. } => continue,
                GatewayRead::Response {
                    id,
                    ok,
                    payload,
                    error_message,
                } => {
                    if id != request_id {
                        continue;
                    }

                    if !ok {
                        return Err(error_message.unwrap_or_else(|| {
                            "OpenClaw gateway request failed without an error message."
                                .to_string()
                        }));
                    }

                    if expect_final
                        && payload
                            .get("status")
                            .and_then(Value::as_str)
                            .is_some_and(|status| status == "accepted")
                    {
                        continue;
                    }

                    return Ok(payload);
                }
            }
        }
    }

    fn close(&mut self) -> Result<(), String> {
        self.socket
            .close(None)
            .map_err(|error| format!("Failed to close the OpenClaw gateway websocket: {error}"))
    }
}

fn configure_gateway_socket(socket: &mut OpenClawSocket) -> Result<(), String> {
    let timeout = Some(Duration::from_millis(OPENCLAW_GATEWAY_EVENT_POLL_TIMEOUT_MS));
    match socket.get_mut() {
        MaybeTlsStream::Plain(stream) => stream.set_read_timeout(timeout),
        MaybeTlsStream::Rustls(stream) => stream.get_mut().set_read_timeout(timeout),
        _ => Ok(()),
    }
    .map_err(|error| format!("Failed to configure OpenClaw websocket timeouts: {error}"))
}

fn read_gateway_frame(socket: &mut OpenClawSocket) -> Result<GatewayRead, String> {
    match socket.read() {
        Ok(WsMessage::Text(text)) => {
            let payload: Value = serde_json::from_str(text.as_ref())
                .map_err(|error| format!("Failed to parse OpenClaw websocket frame: {error}"))?;
            let Some(frame_type) = payload.get("type").and_then(Value::as_str) else {
                return Ok(GatewayRead::Ignore);
            };

            match frame_type {
                "event" => Ok(GatewayRead::Event {
                    event: payload
                        .get("event")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    payload: payload.get("payload").cloned().unwrap_or(Value::Null),
                }),
                "res" => Ok(GatewayRead::Response {
                    id: payload
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    ok: payload.get("ok").and_then(Value::as_bool).unwrap_or(false),
                    payload: payload.get("payload").cloned().unwrap_or(Value::Null),
                    error_message: payload
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                        .or_else(|| {
                            payload
                                .get("error")
                                .map(compact_json_value)
                                .filter(|value| value != "null")
                        }),
                }),
                _ => Ok(GatewayRead::Ignore),
            }
        }
        Ok(WsMessage::Binary(_)) => Ok(GatewayRead::Ignore),
        Ok(WsMessage::Ping(_)) | Ok(WsMessage::Pong(_)) => Ok(GatewayRead::Ignore),
        Ok(WsMessage::Close(frame)) => Ok(GatewayRead::Closed(
            frame
                .map(|value| value.reason.to_string())
                .filter(|value| !value.trim().is_empty()),
        )),
        Ok(_) => Ok(GatewayRead::Ignore),
        Err(tungstenite::Error::ConnectionClosed) | Err(tungstenite::Error::AlreadyClosed) => {
            Ok(GatewayRead::Closed(None))
        }
        Err(tungstenite::Error::Io(error))
            if matches!(error.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) =>
        {
            Ok(GatewayRead::Timeout)
        }
        Err(error) => Err(format!("OpenClaw websocket read failed: {error}")),
    }
}

fn send_gateway_json(socket: &mut OpenClawSocket, value: Value) -> Result<(), String> {
    socket
        .send(WsMessage::Text(value.to_string().into()))
        .map_err(|error| format!("OpenClaw websocket write failed: {error}"))
}

fn next_gateway_request_id() -> String {
    format!(
        "voice-overlay-{}",
        GATEWAY_REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn system_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn build_openclaw_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(OPENCLAW_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(OPENCLAW_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Failed to build OpenClaw HTTP client: {error}"))
}

fn parse_openclaw_response(
    content_type: &str,
    body: &str,
) -> Result<(String, Option<String>), String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err("OpenClaw response was empty.".to_string());
    }

    if content_type.contains("json") || looks_like_json(trimmed) {
        let payload: Value = serde_json::from_str(trimmed)
            .map_err(|error| format!("Failed to parse OpenClaw JSON response: {error}"))?;
        let text = extract_response_text(&payload).ok_or_else(|| {
            "OpenClaw response JSON did not contain a supported text field.".to_string()
        })?;
        let response_session_id = extract_response_session_id(&payload);
        return Ok((text, response_session_id));
    }

    Ok((trimmed.to_string(), None))
}

fn extract_response_text(payload: &Value) -> Option<String> {
    for path in [
        &["response"][..],
        &["text"][..],
        &["message"][..],
        &["output"][..],
        &["content"][..],
        &["reply"][..],
        &["data", "response"][..],
        &["data", "text"][..],
        &["result", "text"][..],
        &["result", "message"][..],
        &["assistant", "text"][..],
        &["assistant", "message"][..],
        &["choices", "0", "message", "content"][..],
        &["choices", "0", "text"][..],
    ] {
        if let Some(value) = value_at_path(payload, path) {
            if let Some(text) = value_to_text(value) {
                return Some(text);
            }
        }
    }

    value_to_text(payload)
}

fn extract_response_session_id(payload: &Value) -> Option<String> {
    for path in [
        &["sessionId"][..],
        &["session_id"][..],
        &["session", "id"][..],
        &["conversationId"][..],
        &["conversation_id"][..],
        &["conversation", "id"][..],
        &["data", "sessionId"][..],
        &["data", "session_id"][..],
    ] {
        if let Some(value) = value_at_path(payload, path) {
            if let Some(text) = value.as_str().map(str::trim).filter(|value| !value.is_empty()) {
                return Some(text.to_string());
            }
        }
    }

    None
}

fn value_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for segment in path {
        if let Ok(index) = segment.parse::<usize>() {
            current = current.get(index)?;
        } else {
            current = current.get(*segment)?;
        }
    }
    Some(current)
}

fn value_to_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().filter_map(value_to_text).collect();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        Value::Object(map) => {
            for key in [
                "text",
                "content",
                "message",
                "output",
                "response",
                "reply",
                "partialResult",
                "result",
            ] {
                if let Some(value) = map.get(key) {
                    if let Some(text) = value_to_text(value) {
                        return Some(text);
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn looks_like_json(value: &str) -> bool {
    let trimmed = value.trim_start();
    trimmed.starts_with('{') || trimmed.starts_with('[')
}

fn compact_response_body(body: &str) -> String {
    let compact = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() > 300 {
        compact.chars().take(300).collect::<String>() + "…"
    } else {
        compact
    }
}

fn first_non_empty(primary: Option<&str>, fallback: &str) -> Option<String> {
    primary
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .or_else(|| {
            let trimmed = fallback.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
}
