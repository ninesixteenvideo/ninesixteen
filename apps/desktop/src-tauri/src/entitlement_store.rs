use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedEntitlement {
    pub uid: String,
    pub pro: bool,
    pub pro_ends_at_ms: Option<i64>,
}

fn cache_path() -> PathBuf {
    crate::recordings::recordings_dir().join(".entitlement.json")
}

pub fn load() -> Option<CachedEntitlement> {
    let path = cache_path();
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn save(uid: &str, pro: bool, pro_ends_at_ms: Option<i64>) {
    let path = cache_path();
    let data = CachedEntitlement {
        uid: uid.to_string(),
        pro,
        pro_ends_at_ms,
    };
    if let Ok(json) = serde_json::to_string(&data) {
        let _ = std::fs::write(path, json);
    }
}

pub fn clear() {
    let _ = std::fs::remove_file(cache_path());
}

pub fn cached_pro_valid(cached: &CachedEntitlement) -> bool {
    if !cached.pro {
        return false;
    }
    if let Some(ends) = cached.pro_ends_at_ms {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        if ends <= now {
            return false;
        }
    }
    true
}
