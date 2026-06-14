//! Virtual webcam via softcam (DirectShow). Appears as "ninesixteen.video" in camera lists.

use libloading::Library;
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

type ScCamera = *mut std::ffi::c_void;
type ScCreateCamera = unsafe extern "C" fn(i32, i32, f32) -> ScCamera;
type ScDeleteCamera = unsafe extern "C" fn(ScCamera);
type ScSendFrame = unsafe extern "C" fn(ScCamera, *const std::ffi::c_void);
type ScIsConnected = unsafe extern "C" fn(ScCamera) -> bool;

struct SoftcamApi {
    _lib: Library,
    create: ScCreateCamera,
    delete: ScDeleteCamera,
    send: ScSendFrame,
    is_connected: ScIsConnected,
}

impl SoftcamApi {
    fn load() -> Result<Self, String> {
        com_init();
        let path = locate_dll()?;
        register_directshow_filter(&path);
        unsafe {
            let lib = Library::new(&path).map_err(|e| format!("load softcam.dll: {e}"))?;
            let create = *lib
                .get::<ScCreateCamera>(b"scCreateCamera")
                .map_err(|e| format!("scCreateCamera: {e}"))?;
            let delete = *lib
                .get::<ScDeleteCamera>(b"scDeleteCamera")
                .map_err(|e| format!("scDeleteCamera: {e}"))?;
            let send = *lib
                .get::<ScSendFrame>(b"scSendFrame")
                .map_err(|e| format!("scSendFrame: {e}"))?;
            let is_connected = *lib
                .get::<ScIsConnected>(b"scIsConnected")
                .map_err(|e| format!("scIsConnected: {e}"))?;
            Ok(Self {
                _lib: lib,
                create,
                delete,
                send,
                is_connected,
            })
        }
    }
}

/// Stable per-user install path for softcam.dll, e.g.
/// `%LOCALAPPDATA%\ninesixteen.video\softcam.dll`. Loading and DirectShow
/// registration both use this path so the DLL another app has open is never the
/// one a rebuild overwrites in the target/ tree (the source of `os error 32`).
fn stable_dll_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("ninesixteen.video").join("softcam.dll"))
}

/// Best-effort: ensure the stable copy exists and matches `src`. Failures are
/// ignored (e.g. the file is currently loaded) — callers fall back to `src`.
fn mirror_to_stable(src: &Path) -> Option<PathBuf> {
    let stable = stable_dll_path()?;
    let fresh = std::fs::metadata(&stable)
        .ok()
        .zip(std::fs::metadata(src).ok())
        .map(|(a, b)| a.len() == b.len())
        .unwrap_or(false);
    if !fresh {
        if let Some(dir) = stable.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::copy(src, &stable);
    }
    stable.exists().then_some(stable)
}

fn locate_dll() -> Result<PathBuf, String> {
    // Prefer the stable per-user copy so we never load (and lock) the build-tree
    // copy that rebuilds overwrite.
    if let Some(stable) = stable_dll_path() {
        if stable.exists() {
            return Ok(stable);
        }
    }

    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("softcam.dll"));
            candidates.push(dir.join("softcam").join("softcam.dll"));
            candidates.push(dir.join("resources").join("softcam").join("softcam.dll"));
        }
    }
    candidates.push(PathBuf::from("softcam.dll"));
    candidates.push(PathBuf::from("resources/softcam/softcam.dll"));
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("softcam")
            .join("softcam.dll"),
    );

    for p in candidates {
        if p.exists() {
            // Provision the stable copy for next launch (and for DirectShow), but
            // load it this run too so the app never holds the build-tree file open.
            if let Some(stable) = mirror_to_stable(&p) {
                return Ok(stable);
            }
            return Ok(p);
        }
    }

    Err(
        "softcam.dll not found. Run: node scripts/fetch-softcam.mjs (requires Visual Studio Build Tools)."
            .into(),
    )
}

/// One-time note only — never call DllRegisterServer at runtime (can freeze the app / DirectShow).
fn register_directshow_filter(_path: &Path) {
    use std::sync::OnceLock;
    static LOGGED: OnceLock<()> = OnceLock::new();
    LOGGED.get_or_init(|| {
        crate::log::capture_log(
            "Virtual camera uses DirectShow — if ninesixteen.video is missing from camera lists, run scripts/register-softcam.bat as Administrator once.",
        );
    });
}

#[cfg(windows)]
fn com_init() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

#[cfg(not(windows))]
fn com_init() {}

static API: OnceLock<Result<SoftcamApi, String>> = OnceLock::new();

fn api() -> Result<&'static SoftcamApi, String> {
    API.get_or_init(SoftcamApi::load)
        .as_ref()
        .map_err(|e| e.clone())
}

pub struct VirtualCamera {
    handle: ScCamera,
    width: u32,
    height: u32,
    bgr_scratch: Vec<u8>,
}

// softcam owns the handle; we only touch it from the WGC capture thread behind a mutex.
unsafe impl Send for VirtualCamera {}
unsafe impl Sync for VirtualCamera {}

impl VirtualCamera {
    pub fn open(width: u32, height: u32, fps: u32) -> Result<Self, String> {
        com_init();
        let w = align4(width)?;
        let h = align4(height)?;
        let api = api()?;
        unsafe {
            let handle = (api.create)(w as i32, h as i32, fps.max(1) as f32);
            if handle.is_null() {
                return Err(
                    "Could not create virtual camera (another app may already be using it)."
                        .into(),
                );
            }
            Ok(Self {
                handle,
                width: w,
                height: h,
                bgr_scratch: vec![0u8; (w * h * 3) as usize],
            })
        }
    }

    pub fn is_connected(&self) -> bool {
        let Ok(api) = api() else {
            return false;
        };
        unsafe { (api.is_connected)(self.handle) }
    }

    /// Send a BGRA frame (will be converted to BGR for DirectShow).
    pub fn send_bgra(&mut self, bgra: &[u8]) {
        let row_bgra = (self.width * 4) as usize;
        let row_bgr = (self.width * 3) as usize;
        let needed = row_bgra * self.height as usize;
        if bgra.len() < needed {
            return;
        }
        for y in 0..self.height as usize {
            let src = &bgra[y * row_bgra..];
            let dst = &mut self.bgr_scratch[y * row_bgr..y * row_bgr + row_bgr];
            for x in 0..self.width as usize {
                dst[x * 3] = src[x * 4];
                dst[x * 3 + 1] = src[x * 4 + 1];
                dst[x * 3 + 2] = src[x * 4 + 2];
            }
        }
        if let Ok(api) = api() {
            unsafe {
                (api.send)(self.handle, self.bgr_scratch.as_ptr() as *const _);
            }
        }
    }
}

impl Drop for VirtualCamera {
    fn drop(&mut self) {
        if let Ok(api) = api() {
            unsafe {
                (api.delete)(self.handle);
            }
        }
    }
}

fn align4(v: u32) -> Result<u32, String> {
    if v == 0 {
        return Err("invalid camera dimensions".into());
    }
    Ok((v + 3) & !3)
}

static CAMERA_SINK: OnceLock<Arc<Mutex<Option<VirtualCamera>>>> = OnceLock::new();

pub fn camera_sink() -> &'static Arc<Mutex<Option<VirtualCamera>>> {
    CAMERA_SINK.get_or_init(|| Arc::new(Mutex::new(None)))
}

pub fn start_camera(width: u32, height: u32, fps: u32) -> Result<(), String> {
    let cam = VirtualCamera::open(width, height, fps)?;
    *camera_sink().lock() = Some(cam);
    Ok(())
}

pub fn stop_camera() {
    camera_sink().lock().take();
}

pub fn camera_connected() -> bool {
    camera_sink()
        .lock()
        .as_ref()
        .map(|c| c.is_connected())
        .unwrap_or(false)
}
