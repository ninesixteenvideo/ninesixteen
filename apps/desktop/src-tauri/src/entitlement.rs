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
        let pro = payload.get("pro").and_then(|v| v.as_bool()) == Some(true);
        // Server spoke — mark this session as genuinely verified.
        crate::state::global_entitlement()
            .lock()
            .apply_server_verified(pro);
        return Ok(pro);
    }

    if status == reqwest::StatusCode::FORBIDDEN {
        crate::state::global_entitlement()
            .lock()
            .apply_server_verified(false);
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

/// Verify the caller owns Pro before allowing an export.
///
/// The server is the source of truth here: the local cache (`.entitlement.json`,
/// in-memory `apply_entitlement_cache`) is user-editable and is **never** trusted
/// on its own to unlock an export. We only fall back to the cache when the server
/// is unreachable, and only for a license the server confirmed earlier this
/// session (`server_verified`) — so a tampered cache can't mint exports offline.
pub fn verify_pro_export(id_token: &str) -> Result<(), String> {
    match verify_request(id_token) {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                let payload: serde_json::Value = response
                    .json()
                    .map_err(|e| format!("Invalid verification response: {e}"))?;
                let pro = payload.get("pro").and_then(|v| v.as_bool()) == Some(true);
                crate::state::global_entitlement()
                    .lock()
                    .apply_server_verified(pro);
                return if pro {
                    Ok(())
                } else {
                    Err("Pro is required to export. Buy Pro to unlock export.".to_string())
                };
            }
            if status == reqwest::StatusCode::FORBIDDEN {
                crate::state::global_entitlement()
                    .lock()
                    .apply_server_verified(false);
                return Err("Pro is required to export. Buy Pro to unlock export.".to_string());
            }
            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err("Sign in required".to_string());
            }
            // 5xx / unexpected — treat like unreachable and fall through to grace.
        }
        Err(_) => { /* network failure — fall through to offline grace */ }
    }

    let cache = crate::state::global_entitlement();
    let guard = cache.lock();
    if guard.is_pro() && guard.server_verified() {
        Ok(())
    } else {
        Err(
            "Could not verify your Pro license — connect to the internet and try again."
                .to_string(),
        )
    }
}

pub fn persist_entitlement(uid: &str, pro: bool, pro_ends_at_ms: Option<i64>) {
    apply_cached_to_memory(uid, pro, pro_ends_at_ms);
}

pub fn clear_persisted_entitlement() {
    crate::entitlement_store::clear();
    crate::state::global_entitlement().lock().clear();
}
