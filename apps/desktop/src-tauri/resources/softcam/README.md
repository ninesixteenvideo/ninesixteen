# Virtual camera (softcam)

The desktop app loads `softcam.dll` from this folder (or next to the executable).

Build it once from the repo root:

```bash
node scripts/fetch-softcam.mjs
```

Requires **Visual Studio Build Tools** with the C++ workload (MSBuild).

After a successful build, pick **ninesixteen.video** as your camera in OBS, Twitch, Zoom, or your browser.
