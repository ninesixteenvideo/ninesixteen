# FFmpeg (recording)

The desktop app loads `ffmpeg.exe` from this folder (or from PATH).

Fetch it once from the repo root:

```bash
node scripts/fetch-ffmpeg.mjs
```

Recording pipes cropped BGRA frames to FFmpeg and writes an MP4 to your Videos/ninesixteen folder.
