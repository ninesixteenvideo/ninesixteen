//! At-rest encryption for recordings.
//!
//! Recordings are stored as `.ns` files (AES-256-CTR). The in-app player streams
//! decrypted bytes through the `nsmedia` protocol, and a paid Export decrypts to a
//! real `.mp4`. This stops a free user from copying playable files out of the
//! recordings folder — they only ever see encrypted blobs on disk.
//!
//! Note: the key is embedded in the binary. This is deliberate, casual-copy
//! protection (not unbreakable DRM); it raises the bar far above plaintext MP4s.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

use aes::Aes256;
use ctr::cipher::{KeyIvInit, StreamCipher, StreamCipherSeek};

type NsCipher = ctr::Ctr128BE<Aes256>;

const MAGIC: &[u8; 4] = b"NSV1";
/// Header = 4-byte magic + 16-byte IV.
const HEADER_LEN: u64 = 20;

/// Embedded 256-bit key. Obfuscated constant, not secret-grade.
fn key() -> [u8; 32] {
    [
        0x6e, 0x39, 0x31, 0x36, 0xa7, 0xc4, 0x1d, 0x8b, 0x52, 0xf0, 0x0e, 0x77, 0x9c, 0x3a, 0xd5,
        0x21, 0x84, 0xbb, 0x6f, 0x12, 0x40, 0xe9, 0x7d, 0xaa, 0x05, 0xc8, 0x33, 0x9e, 0x57, 0x2c,
        0xf1, 0x68,
    ]
}

fn cipher_with(iv: &[u8; 16]) -> NsCipher {
    NsCipher::new_from_slices(&key(), iv).expect("valid key/iv length")
}

const CHUNK: usize = 1024 * 1024;

/// Encrypt `src` (a plaintext file) into `dst` (an `.ns` file).
pub fn encrypt_file(src: &Path, dst: &Path) -> io::Result<()> {
    encrypt_file_with_progress(src, dst, |_| {})
}

/// Stream-encrypt `src` into `dst`, calling `on_progress` with 0–100 as bytes are written.
pub fn encrypt_file_with_progress<F>(src: &Path, dst: &Path, mut on_progress: F) -> io::Result<()>
where
    F: FnMut(u8),
{
    let total = std::fs::metadata(src)?.len();
    let mut inp = File::open(src)?;
    let iv = *uuid::Uuid::new_v4().as_bytes();
    let mut cipher = cipher_with(&iv);
    let mut out = File::create(dst)?;
    out.write_all(MAGIC)?;
    out.write_all(&iv)?;

    let mut buf = vec![0u8; CHUNK];
    let mut done = 0u64;
    on_progress(0);

    loop {
        let n = inp.read(&mut buf)?;
        if n == 0 {
            break;
        }
        let mut chunk = buf[..n].to_vec();
        cipher.apply_keystream(&mut chunk);
        out.write_all(&chunk)?;
        done += n as u64;
        if total > 0 {
            on_progress(((done.saturating_mul(100)) / total).min(100) as u8);
        }
    }

    on_progress(100);
    Ok(())
}

fn read_iv(f: &mut File) -> io::Result<[u8; 16]> {
    let mut magic = [0u8; 4];
    f.read_exact(&mut magic)?;
    if &magic != MAGIC {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "not an ns file"));
    }
    let mut iv = [0u8; 16];
    f.read_exact(&mut iv)?;
    Ok(iv)
}

/// Plaintext byte length of an `.ns` file (file size minus header).
pub fn plaintext_len(src: &Path) -> io::Result<u64> {
    Ok(std::fs::metadata(src)?.len().saturating_sub(HEADER_LEN))
}

/// Decrypt an entire `.ns` file into `dst` (used by paid Export).
pub fn decrypt_to_file(src: &Path, dst: &Path) -> io::Result<()> {
    let mut f = File::open(src)?;
    let iv = read_iv(&mut f)?;
    let mut data = Vec::new();
    f.read_to_end(&mut data)?;
    let mut cipher = cipher_with(&iv);
    cipher.apply_keystream(&mut data);
    File::create(dst)?.write_all(&data)?;
    Ok(())
}

/// Decrypt a plaintext byte range `[start, start+len)` — for range-served playback.
/// CTR mode lets us seek the keystream so we only touch the requested bytes.
pub fn decrypt_range(src: &Path, start: u64, len: usize) -> io::Result<Vec<u8>> {
    let mut f = File::open(src)?;
    let iv = read_iv(&mut f)?;
    f.seek(SeekFrom::Start(HEADER_LEN + start))?;

    let mut buf = vec![0u8; len];
    let mut filled = 0;
    while filled < buf.len() {
        let n = f.read(&mut buf[filled..])?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    buf.truncate(filled);

    let mut cipher = cipher_with(&iv);
    cipher.seek(start);
    cipher.apply_keystream(&mut buf);
    Ok(buf)
}
