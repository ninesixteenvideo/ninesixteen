use crate::geometry::{normalize_quality, output_dims, pixel_load, QUALITY_1080, QUALITY_1440, QUALITY_2160, QUALITY_720};
use crate::state::Orientation;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug)]
struct HardwareSnapshot {
    ram_mb: u64,
    vram_mb: u64,
    cpu_threads: u32,
    discrete_gpu: bool,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareRecommendation {
    pub max_quality: u32,
    pub max_fps: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    pub portrait: HardwareRecommendation,
    pub landscape: HardwareRecommendation,
}

static SNAPSHOT: OnceLock<HardwareSnapshot> = OnceLock::new();

pub fn hardware_profile() -> HardwareProfile {
    let snap = SNAPSHOT.get_or_init(probe_snapshot);
    HardwareProfile {
        portrait: recommend_for(*snap, Orientation::Portrait),
        landscape: recommend_for(*snap, Orientation::Landscape),
    }
}

fn probe_snapshot() -> HardwareSnapshot {
    #[cfg(windows)]
    {
        let (vram_mb, discrete_gpu) = probe_gpu();
        let ram_mb = probe_ram_mb();
        let cpu_threads = std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(4)
            .max(1);
        HardwareSnapshot {
            ram_mb,
            vram_mb,
            cpu_threads,
            discrete_gpu,
        }
    }
    #[cfg(not(windows))]
    {
        HardwareSnapshot {
            ram_mb: 8192,
            vram_mb: 2048,
            cpu_threads: 4,
            discrete_gpu: true,
        }
    }
}

#[cfg(windows)]
fn probe_ram_mb() -> u64 {
    use windows::Win32::System::SystemInformation::GetPhysicallyInstalledSystemMemory;
    let mut kb = 0u64;
    unsafe {
        if GetPhysicallyInstalledSystemMemory(&mut kb).is_ok() && kb > 0 {
            return kb / 1024;
        }
    }
    8192
}

#[cfg(windows)]
fn probe_gpu() -> (u64, bool) {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};

    const DXGI_ADAPTER_FLAG_SOFTWARE: u32 = 2;

    unsafe {
        let factory: IDXGIFactory1 = match CreateDXGIFactory1() {
            Ok(f) => f,
            Err(_) => return (0, false),
        };
        let mut best_vram = 0u64;
        let mut discrete = false;
        for i in 0u32..16 {
            let adapter = match factory.EnumAdapters1(i) {
                Ok(a) => a,
                Err(_) => break,
            };
            let desc = match adapter.GetDesc1() {
                Ok(d) => d,
                Err(_) => continue,
            };
            if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE != 0 {
                continue;
            }
            let vram = desc.DedicatedVideoMemory as u64;
            if vram > best_vram {
                best_vram = vram;
                discrete = desc.VendorId != 0x1414 && vram >= 512 * 1024 * 1024;
            }
        }
        (best_vram / (1024 * 1024), discrete)
    }
}

/// Score hardware into a pixel-load budget, then map to the highest supported tier.
fn recommend_for(snap: HardwareSnapshot, orientation: Orientation) -> HardwareRecommendation {
    let mut tier = score_tier(snap);

    // Software / iGPU-only paths struggle with sustained 60fps encodes.
    if !snap.discrete_gpu {
        tier = tier.min(1);
    }
    if snap.vram_mb < 1200 {
        tier = tier.min(0);
    } else if snap.vram_mb < 2500 {
        tier = tier.min(1);
    } else if snap.vram_mb < 4500 {
        tier = tier.min(2);
    } else if snap.vram_mb < 6500 {
        tier = tier.min(3);
    }

    let (mut quality, mut fps) = tier_to_quality_fps(tier, orientation);
    quality = normalize_quality(quality, orientation);

    // Portrait never exceeds 1080p — normalize_quality already enforces this.
    if orientation == Orientation::Portrait && quality > QUALITY_1080 {
        quality = QUALITY_1080;
    }

    // Verify the tier is encodable at CFR — step down if pixel load exceeds budget.
    let budget = tier_pixel_budget(tier);
    while load_for(orientation, quality, fps) > budget && !(quality == QUALITY_720 && fps == 30) {
        if fps > 30 {
            fps = 30;
        } else if quality > QUALITY_720 {
            quality = match quality {
                x if x >= QUALITY_2160 => QUALITY_1440,
                x if x >= QUALITY_1440 => QUALITY_1080,
                _ => QUALITY_720,
            };
            quality = normalize_quality(quality, orientation);
        } else {
            break;
        }
    }

    HardwareRecommendation {
        max_quality: quality,
        max_fps: fps,
    }
}

fn score_tier(snap: HardwareSnapshot) -> u32 {
    let mut score = 0u32;
    if snap.ram_mb >= 28000 && snap.cpu_threads >= 10 {
        score += 4;
    } else if snap.ram_mb >= 20000 && snap.cpu_threads >= 8 {
        score += 3;
    } else if snap.ram_mb >= 14000 && snap.cpu_threads >= 6 {
        score += 2;
    } else if snap.ram_mb >= 9000 && snap.cpu_threads >= 4 {
        score += 1;
    }

    if snap.discrete_gpu {
        score += 1;
    }
    if snap.vram_mb >= 7000 {
        score += 2;
    } else if snap.vram_mb >= 3500 {
        score += 1;
    }

    score.min(4)
}

fn tier_pixel_budget(tier: u32) -> u64 {
    match tier {
        4 => pixel_load(3840, 2160, 60),
        3 => pixel_load(2560, 1440, 60),
        2 => pixel_load(1920, 1080, 60),
        1 => pixel_load(1920, 1080, 30),
        _ => pixel_load(1280, 720, 30),
    }
}

fn tier_to_quality_fps(tier: u32, orientation: Orientation) -> (u32, u32) {
    let (quality, fps) = match tier {
        4 => (QUALITY_2160, 60),
        3 => (QUALITY_1440, 60),
        2 => (QUALITY_1080, 60),
        1 => (QUALITY_1080, 30),
        _ => (QUALITY_720, 30),
    };
    if orientation == Orientation::Portrait && quality > QUALITY_1080 {
        (QUALITY_1080, fps)
    } else {
        (quality, fps)
    }
}

fn load_for(orientation: Orientation, quality: u32, fps: u32) -> u64 {
    let (w, h) = output_dims(orientation, quality);
    pixel_load(w, h, fps)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modest_hardware_recommends_720p30() {
        let snap = HardwareSnapshot {
            ram_mb: 6000,
            vram_mb: 800,
            cpu_threads: 4,
            discrete_gpu: false,
        };
        let rec = recommend_for(snap, Orientation::Portrait);
        assert_eq!(rec.max_quality, QUALITY_720);
        assert_eq!(rec.max_fps, 30);
    }

    #[test]
    fn strong_hardware_recommends_1440p60_landscape() {
        let snap = HardwareSnapshot {
            ram_mb: 24000,
            vram_mb: 8000,
            cpu_threads: 12,
            discrete_gpu: true,
        };
        let rec = recommend_for(snap, Orientation::Landscape);
        assert!(rec.max_quality >= QUALITY_1440);
        assert_eq!(rec.max_fps, 60);
    }

    #[test]
    fn portrait_never_exceeds_1080p() {
        let snap = HardwareSnapshot {
            ram_mb: 32000,
            vram_mb: 12000,
            cpu_threads: 16,
            discrete_gpu: true,
        };
        let rec = recommend_for(snap, Orientation::Portrait);
        assert!(rec.max_quality <= QUALITY_1080);
    }
}
