use std::time::Duration;

const WEB_API_BASE: &str = env!("NS_WEB_API_BASE");

fn verify_request(id_token: &str) -> Result<reqwest::blocking::Response, String> {
    let token = id_token.trim();
    if token.is_empty() {
        return Err("Sign in required".to_string());
    }

    let url = format!("{WEB_API_BASE}/api/entitlement/verify");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Verification failed: {e}"))?;

    client
        .get(&url)
        .bearer_auth(token)
        .send()
        .map_err(|e| format!("Could not verify your Pro license: {e}"))
}

fn apply_cached_to_memory(uid: &str, pro: bool, pro_ends_at_ms: Option<i64>) {
    crate::entitlement_store::save(uid, pro, pro_ends_at_ms);
    crate::state::global_entitlement()
        .lock()
        .apply(uid, pro, pro_ends_at_ms);
}

/// Load persisted entitlement from disk into the in-memory cache (app startup / offline).
pub fn hydrate_from_disk() {
    let Some(cached) = crate::entitlement_store::load() else {
        return;
    };
    if crate::entitlement_store::cached_pro_valid(&cached) {
        crate::state::global_entitlement().lock().apply(
            &cached.uid,
            cached.pro,
            cached.pro_ends_at_ms,
        );
    }
}

/// Returns `Ok(true)` for Pro, `Ok(false)` for signed-in trial, `Err` on auth/network failure.
pub fn check_entitlement(id_token: &str) -> Result<bool, String> {
    let response = verify_request(id_token);
    let response = match response {
        Ok(r) => r,
        Err(e) => {
            if let Some(cached) = crate::entitlement_store::load() {
                if crate::entitlement_store::cached_pro_valid(&cached) {
                    crate::state::global_entitlement().lock().apply(
                        &cached.uid,
                        cached.pro,
                        cached.pro_ends_at_ms,
                    );
                    return Ok(cached.pro);
                }
            }
            return Err(e);
        }
    };

    let status = response.status();

    if status.is_success() {
        let payload: serde_json::Value = response
            .json()
            .map_err(|e| format!("Invalid verification response: {e}"))?;
        return Ok(payload.get("pro").and_then(|v| v.as_bool()) == Some(true));
    }

    if status == reqwest::StatusCode::FORBIDDEN {
        return Ok(false);
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Sign in required".to_string());
    }

    if let Some(cached) = crate::entitlement_store::load() {
        if crate::entitlement_store::cached_pro_valid(&cached) {
            crate::state::global_entitlement().lock().apply(
                &cached.uid,
                cached.pro,
                cached.pro_ends_at_ms,
            );
            return Ok(cached.pro);
        }
    }

    Err("Could not verify your Pro license — check your connection and try again".to_string())
}

/// Verify the caller owns Pro via the web API (offline cache fallback).
pub fn verify_pro_export(id_token: &str) -> Result<(), String> {
    if crate::state::global_entitlement().lock().is_pro() {
        return Ok(());
    }

    match check_entitlement(id_token)? {
        true => Ok(()),
        false => Err("Pro is required to export. Buy Pro to unlock export.".to_string()),
    }
}

pub fn persist_entitlement(uid: &str, pro: bool, pro_ends_at_ms: Option<i64>) {
    apply_cached_to_memory(uid, pro, pro_ends_at_ms);
}

pub fn clear_persisted_entitlement() {
    crate::entitlement_store::clear();
    crate::state::global_entitlement().lock().clear();
}
