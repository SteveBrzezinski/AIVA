use crate::{run_controller::RunAccess, settings::AppSettings};
use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const OPENCLAW_CONNECT_TIMEOUT_SECS: u64 = 5;
const OPENCLAW_REQUEST_TIMEOUT_SECS: u64 = 120;

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
    pub agent_id: Option<String>,
    pub requested_session_id: Option<String>,
    pub response_session_id: Option<String>,
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
            "OpenClaw endpoint URL is missing. Save one in Settings before using the voice bridge."
                .to_string(),
        );
    }

    let agent_id = first_non_empty(options.agent_id.as_deref(), settings.openclaw_agent_id.as_str());
    let requested_session_id =
        first_non_empty(options.session_id.as_deref(), settings.openclaw_session_id.as_str());

    if let Some(run_access) = run_access {
        run_access.wait_if_paused()?;
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
        run_access.wait_if_paused()?;
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

    Ok(OpenClawBridgeResult {
        text,
        endpoint_url,
        agent_id,
        requested_session_id,
        response_session_id,
    })
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
    // TODO: Replace this tolerant parser with the final OpenClaw route contract once that backend
    // endpoint is fixed. For now the bridge accepts a few obvious text response shapes.
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
            for key in ["text", "content", "message", "output", "response", "reply"] {
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
