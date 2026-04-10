use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

pub const VOICE_TIMER_EVENT: &str = "voice-timer";

const MIN_TIMER_DURATION_MS: u64 = 1_000;
const MAX_TIMER_DURATION_MS: u64 = 24 * 60 * 60 * 1000;
const TIMER_POLL_INTERVAL_MS: u64 = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTimer {
    pub id: String,
    pub title: String,
    pub status: String,
    pub duration_ms: u64,
    pub remaining_ms: u64,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub end_at_ms: Option<u64>,
    pub completed_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceTimerEventPayload {
    pub kind: String,
    pub timer: VoiceTimer,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVoiceTimerRequest {
    pub title: Option<String>,
    pub duration_ms: Option<u64>,
    pub duration_minutes: Option<u64>,
    pub duration_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateVoiceTimerRequest {
    pub timer_id: String,
    pub title: Option<String>,
    pub duration_ms: Option<u64>,
    pub duration_minutes: Option<u64>,
    pub duration_seconds: Option<u64>,
}

pub struct VoiceTimerState {
    next_id: AtomicU64,
    timers: Mutex<HashMap<String, VoiceTimer>>,
}

impl Default for VoiceTimerState {
    fn default() -> Self {
        Self { next_id: AtomicU64::new(1), timers: Mutex::new(HashMap::new()) }
    }
}

impl VoiceTimerState {
    pub fn list_timers(&self) -> Vec<VoiceTimer> {
        let mut timers = self
            .timers
            .lock()
            .expect("voice timer state poisoned")
            .values()
            .cloned()
            .collect::<Vec<_>>();
        timers.sort_by(|left, right| {
            right
                .updated_at_ms
                .cmp(&left.updated_at_ms)
                .then_with(|| right.created_at_ms.cmp(&left.created_at_ms))
        });
        timers
    }

    pub fn get_timer(&self, timer_id: &str) -> Option<VoiceTimer> {
        self.timers.lock().expect("voice timer state poisoned").get(timer_id).cloned()
    }

    pub fn create_timer(&self, title: Option<&str>, duration_ms: u64) -> Result<VoiceTimer, String> {
        let normalized_duration_ms = normalize_duration_ms(duration_ms)?;
        let created_at_ms = system_time_ms();
        let id = format!(
            "voice-timer-{}-{}",
            created_at_ms,
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );

        let mut timers = self.timers.lock().expect("voice timer state poisoned");
        let title = generate_unique_title(&timers, title, normalized_duration_ms, None);
        let timer = VoiceTimer {
            id: id.clone(),
            title,
            status: "running".to_string(),
            duration_ms: normalized_duration_ms,
            remaining_ms: normalized_duration_ms,
            created_at_ms,
            updated_at_ms: created_at_ms,
            end_at_ms: Some(created_at_ms.saturating_add(normalized_duration_ms)),
            completed_at_ms: None,
        };
        timers.insert(id, timer.clone());
        Ok(timer)
    }

    pub fn update_timer(
        &self,
        timer_id: &str,
        next_title: Option<&str>,
        next_duration_ms: Option<u64>,
    ) -> Result<VoiceTimer, String> {
        let mut timers = self.timers.lock().expect("voice timer state poisoned");
        let normalized_title = next_title.map(normalize_title).transpose()?;
        let normalized_duration_ms = match next_duration_ms {
            Some(value) => Some(normalize_duration_ms(value)?),
            None => None,
        };
        let current = timers
            .get(timer_id)
            .cloned()
            .ok_or_else(|| format!("Timer not found: {timer_id}"))?;
        let unique_title = normalized_title
            .as_ref()
            .map(|title| generate_unique_title(&timers, Some(title), current.duration_ms, Some(timer_id)));

        let timer = timers
            .get_mut(timer_id)
            .ok_or_else(|| format!("Timer not found: {timer_id}"))?;
        let now_ms = system_time_ms();

        if let Some(title) = unique_title {
            timer.title = title;
        }

        if let Some(duration_ms) = normalized_duration_ms {
            if timer.status == "completed" {
                return Err("Completed timers cannot be given a new duration. Create a new timer instead.".to_string());
            }

            timer.duration_ms = duration_ms;
            timer.remaining_ms = duration_ms;
            if timer.status == "running" {
                timer.end_at_ms = Some(now_ms.saturating_add(duration_ms));
            } else {
                timer.end_at_ms = None;
            }
        }

        timer.updated_at_ms = now_ms;
        Ok(timer.clone())
    }

    pub fn pause_timer(&self, timer_id: &str) -> Result<VoiceTimer, String> {
        let mut timers = self.timers.lock().expect("voice timer state poisoned");
        let timer = timers
            .get_mut(timer_id)
            .ok_or_else(|| format!("Timer not found: {timer_id}"))?;
        if timer.status == "completed" {
            return Err("Completed timers cannot be paused.".to_string());
        }
        if timer.status == "paused" {
            return Ok(timer.clone());
        }

        let now_ms = system_time_ms();
        timer.remaining_ms = calculate_remaining_ms(timer, now_ms);
        timer.end_at_ms = None;
        timer.status = "paused".to_string();
        timer.updated_at_ms = now_ms;
        Ok(timer.clone())
    }

    pub fn resume_timer(&self, timer_id: &str) -> Result<VoiceTimer, String> {
        let mut timers = self.timers.lock().expect("voice timer state poisoned");
        let timer = timers
            .get_mut(timer_id)
            .ok_or_else(|| format!("Timer not found: {timer_id}"))?;
        if timer.status == "completed" {
            return Err("Completed timers cannot be resumed.".to_string());
        }
        if timer.status == "running" {
            return Ok(timer.clone());
        }

        let now_ms = system_time_ms();
        let remaining_ms = timer.remaining_ms.max(MIN_TIMER_DURATION_MS);
        timer.remaining_ms = remaining_ms;
        timer.end_at_ms = Some(now_ms.saturating_add(remaining_ms));
        timer.status = "running".to_string();
        timer.updated_at_ms = now_ms;
        Ok(timer.clone())
    }

    pub fn delete_timer(&self, timer_id: &str) -> Result<VoiceTimer, String> {
        self.timers
            .lock()
            .expect("voice timer state poisoned")
            .remove(timer_id)
            .ok_or_else(|| format!("Timer not found: {timer_id}"))
    }

    pub fn complete_due_timers(&self) -> Vec<VoiceTimer> {
        let now_ms = system_time_ms();
        let mut completed = Vec::new();
        let mut timers = self.timers.lock().expect("voice timer state poisoned");

        for timer in timers.values_mut() {
            if timer.status != "running" {
                continue;
            }
            let Some(end_at_ms) = timer.end_at_ms else {
                continue;
            };
            if end_at_ms > now_ms {
                continue;
            }

            timer.status = "completed".to_string();
            timer.remaining_ms = 0;
            timer.end_at_ms = None;
            timer.updated_at_ms = now_ms;
            timer.completed_at_ms = Some(now_ms);
            completed.push(timer.clone());
        }

        completed
    }

    pub fn emit_timer(&self, app: &AppHandle, kind: &str, timer: &VoiceTimer) {
        let _ = app.emit(
            VOICE_TIMER_EVENT,
            VoiceTimerEventPayload {
                kind: kind.to_string(),
                timer: timer.clone(),
            },
        );
    }

    pub fn resolve_timer(&self, timer_id: Option<&str>, query: Option<&str>) -> TimerResolveResult {
        let timers = self.list_timers();

        if let Some(timer_id) = timer_id.filter(|value| !value.trim().is_empty()) {
            return match timers.into_iter().find(|timer| timer.id == timer_id.trim()) {
                Some(timer) => TimerResolveResult::Matched(timer),
                None => TimerResolveResult::NotFound(format!("No timer matched id '{}'.", timer_id.trim())),
            };
        }

        let normalized_query = query
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty());

        if normalized_query.is_none() {
            let active_candidates = timers
                .iter()
                .filter(|timer| timer.status != "completed")
                .cloned()
                .collect::<Vec<_>>();
            if !active_candidates.is_empty() {
                return match active_candidates.len() {
                    1 => TimerResolveResult::Matched(active_candidates[0].clone()),
                    _ => TimerResolveResult::Ambiguous(
                        "Multiple timers are active. Please name which one should be used.".to_string(),
                        active_candidates,
                    ),
                };
            }

            let completed_candidates = timers
                .into_iter()
                .filter(|timer| timer.status == "completed")
                .collect::<Vec<_>>();
            return match completed_candidates.len() {
                0 => TimerResolveResult::NoTimers,
                1 => TimerResolveResult::Matched(completed_candidates[0].clone()),
                _ => TimerResolveResult::Ambiguous(
                    "Multiple completed timers are waiting to be dismissed. Please name which one should be used.".to_string(),
                    completed_candidates,
                ),
            };
        }

        let normalized_query = normalized_query.expect("query should exist");
        let exact_matches = timers
            .iter()
            .filter(|timer| timer.title.trim().eq_ignore_ascii_case(&normalized_query))
            .cloned()
            .collect::<Vec<_>>();

        if exact_matches.len() == 1 {
            return TimerResolveResult::Matched(exact_matches[0].clone());
        }
        if exact_matches.len() > 1 {
            return TimerResolveResult::Ambiguous(
                format!("More than one timer is named '{}'.", normalized_query),
                exact_matches,
            );
        }

        let partial_matches = timers
            .into_iter()
            .filter(|timer| timer.title.to_lowercase().contains(&normalized_query))
            .collect::<Vec<_>>();

        match partial_matches.len() {
            0 => TimerResolveResult::NotFound(format!("No timer matched '{}'.", normalized_query)),
            1 => TimerResolveResult::Matched(partial_matches[0].clone()),
            _ => TimerResolveResult::Ambiguous(
                format!("More than one timer matched '{}'.", normalized_query),
                partial_matches,
            ),
        }
    }
}

pub enum TimerResolveResult {
    Matched(VoiceTimer),
    NotFound(String),
    Ambiguous(String, Vec<VoiceTimer>),
    NoTimers,
}

pub fn start_voice_timer_worker(app: AppHandle) {
    thread::spawn(move || loop {
        let expired = {
            let state = app.state::<VoiceTimerState>();
            state.complete_due_timers()
        };

        if !expired.is_empty() {
            let state = app.state::<VoiceTimerState>();
            for timer in expired {
                state.emit_timer(&app, "completed", &timer);
            }
        }

        thread::sleep(Duration::from_millis(TIMER_POLL_INTERVAL_MS));
    });
}

#[tauri::command]
pub fn list_voice_timers_command(state: State<'_, VoiceTimerState>) -> Vec<VoiceTimer> {
    state.list_timers()
}

#[tauri::command]
pub fn create_voice_timer_command(
    request: CreateVoiceTimerRequest,
    state: State<'_, VoiceTimerState>,
    app: AppHandle,
) -> Result<VoiceTimer, String> {
    let duration_ms = duration_ms_from_parts(
        request.duration_ms,
        request.duration_minutes,
        request.duration_seconds,
    )?;
    let timer = state.create_timer(request.title.as_deref(), duration_ms)?;
    state.emit_timer(&app, "created", &timer);
    Ok(timer)
}

#[tauri::command]
pub fn update_voice_timer_command(
    request: UpdateVoiceTimerRequest,
    state: State<'_, VoiceTimerState>,
    app: AppHandle,
) -> Result<VoiceTimer, String> {
    let duration_ms =
        if request.duration_ms.is_none()
            && request.duration_minutes.is_none()
            && request.duration_seconds.is_none()
        {
            None
        } else {
            Some(duration_ms_from_parts(
                request.duration_ms,
                request.duration_minutes,
                request.duration_seconds,
            )?)
        };
    let timer = state.update_timer(
        &request.timer_id,
        request.title.as_deref(),
        duration_ms,
    )?;
    state.emit_timer(&app, "updated", &timer);
    Ok(timer)
}

#[tauri::command]
pub fn pause_voice_timer_command(
    timer_id: String,
    state: State<'_, VoiceTimerState>,
    app: AppHandle,
) -> Result<VoiceTimer, String> {
    let timer = state.pause_timer(&timer_id)?;
    state.emit_timer(&app, "paused", &timer);
    Ok(timer)
}

#[tauri::command]
pub fn resume_voice_timer_command(
    timer_id: String,
    state: State<'_, VoiceTimerState>,
    app: AppHandle,
) -> Result<VoiceTimer, String> {
    let timer = state.resume_timer(&timer_id)?;
    state.emit_timer(&app, "resumed", &timer);
    Ok(timer)
}

#[tauri::command]
pub fn delete_voice_timer_command(
    timer_id: String,
    state: State<'_, VoiceTimerState>,
    app: AppHandle,
) -> Result<VoiceTimer, String> {
    let timer = state.delete_timer(&timer_id)?;
    state.emit_timer(&app, "deleted", &timer);
    Ok(timer)
}

pub fn timer_to_json(timer: &VoiceTimer) -> Value {
    json!({
        "id": timer.id,
        "title": timer.title,
        "status": timer.status,
        "durationMs": timer.duration_ms,
        "remainingMs": timer.remaining_ms,
        "createdAtMs": timer.created_at_ms,
        "updatedAtMs": timer.updated_at_ms,
        "endAtMs": timer.end_at_ms,
        "completedAtMs": timer.completed_at_ms,
    })
}

pub fn timer_candidates_to_json(timers: &[VoiceTimer]) -> Vec<Value> {
    timers.iter().map(timer_to_json).collect()
}

pub fn format_duration_label(duration_ms: u64) -> String {
    let total_seconds = (duration_ms / 1000).max(1);
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;

    let mut parts = Vec::new();
    if hours > 0 {
        parts.push(format!("{hours} h"));
    }
    if minutes > 0 {
        parts.push(format!("{minutes} min"));
    }
    if seconds > 0 && hours == 0 {
        parts.push(format!("{seconds} sec"));
    }
    if parts.is_empty() {
        parts.push("1 sec".to_string());
    }

    parts.join(" ")
}

pub fn format_default_timer_title(duration_ms: u64) -> String {
    format!("{} timer", format_duration_label(duration_ms))
}

pub fn format_remaining_label(timer: &VoiceTimer) -> String {
    let remaining_ms = current_remaining_ms(timer);
    if remaining_ms == 0 {
        return "done".to_string();
    }
    format_duration_label(remaining_ms)
}

pub fn current_remaining_ms(timer: &VoiceTimer) -> u64 {
    if timer.status != "running" {
        return timer.remaining_ms;
    }
    match timer.end_at_ms {
        Some(end_at_ms) => end_at_ms.saturating_sub(system_time_ms()),
        None => timer.remaining_ms,
    }
}

fn duration_ms_from_parts(
    duration_ms: Option<u64>,
    duration_minutes: Option<u64>,
    duration_seconds: Option<u64>,
) -> Result<u64, String> {
    if let Some(duration_ms) = duration_ms {
        return normalize_duration_ms(duration_ms);
    }

    let total_seconds = duration_minutes.unwrap_or(0).saturating_mul(60) + duration_seconds.unwrap_or(0);
    if total_seconds == 0 {
        return Err("A timer duration is required.".to_string());
    }

    normalize_duration_ms(total_seconds.saturating_mul(1000))
}

fn normalize_duration_ms(duration_ms: u64) -> Result<u64, String> {
    if duration_ms < MIN_TIMER_DURATION_MS {
        return Err("The timer duration must be at least one second.".to_string());
    }
    if duration_ms > MAX_TIMER_DURATION_MS {
        return Err("The timer duration must not exceed 24 hours.".to_string());
    }
    Ok(duration_ms)
}

fn normalize_title(value: &str) -> Result<String, String> {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return Err("Timer titles cannot be empty.".to_string());
    }
    Ok(normalized.chars().take(80).collect())
}

fn generate_unique_title(
    timers: &HashMap<String, VoiceTimer>,
    explicit_title: Option<&str>,
    duration_ms: u64,
    exclude_id: Option<&str>,
) -> String {
    let base_title = explicit_title
        .map(|value| normalize_title(value).unwrap_or_else(|_| format_default_timer_title(duration_ms)))
        .unwrap_or_else(|| format_default_timer_title(duration_ms));

    let existing_titles = timers
        .values()
        .filter(|timer| exclude_id.map(|id| timer.id != id).unwrap_or(true))
        .map(|timer| timer.title.trim().to_lowercase())
        .collect::<Vec<_>>();

    if !existing_titles.iter().any(|value| value == &base_title.to_lowercase()) {
        return base_title;
    }

    let mut suffix = 2u64;
    loop {
        let candidate = format!("{base_title} {suffix}");
        if !existing_titles.iter().any(|value| value == &candidate.to_lowercase()) {
            return candidate;
        }
        suffix = suffix.saturating_add(1);
    }
}

fn calculate_remaining_ms(timer: &VoiceTimer, now_ms: u64) -> u64 {
    match timer.end_at_ms {
        Some(end_at_ms) => end_at_ms.saturating_sub(now_ms),
        None => timer.remaining_ms,
    }
}

fn system_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}
