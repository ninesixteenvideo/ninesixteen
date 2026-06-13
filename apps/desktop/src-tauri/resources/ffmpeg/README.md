# FFmpeg (recording)

The desktop app loads `ffmpeg.exe` from this folder (or from PATH).

Fetch it once from the repo root:

```bash
node scripts/fetch-ffmpeg.mjs
```

Recording pipes cropped BGRA frames to FFmpeg and writes an MP4 to your Videos/ninesixteen folder.

## Supply chain (release builds)

- Prefer a **pinned** download URL when cutting releases — edit `FFMPEG_BUILD_URL` in `scripts/fetch-ffmpeg.mjs` rather than tracking `latest`.
- After fetching, run `ffmpeg.exe -version` and record the version in release notes.
- Scan bundled binaries with your AV pipeline before shipping MSI/NSIS installers.
- Only re-fetch from the official BtbN GitHub releases page you trust.
