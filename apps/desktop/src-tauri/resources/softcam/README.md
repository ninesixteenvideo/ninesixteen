# Virtual camera (softcam)

The desktop app loads `softcam.dll` from this folder (or next to the executable).

Build it once from the repo root:

```bash
node scripts/fetch-softcam.mjs
```

Requires **Visual Studio Build Tools** with the C++ workload (MSBuild).

After a successful build, register the camera once (Administrator):

```bat
scripts\register-softcam.bat
```

Then keep the ninesixteen app running and choose **ninesixteen.video** wherever you pick a camera device. If the list was open before the app started, close and reopen it.
