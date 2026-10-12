# Shorts Generator

Turns a video file or YouTube link into a captioned, punched-in 1080x1920 60 fps Short using Remotion and local Whisper.

## Setup on a new device

Requires Node 20+ (22 recommended). No Python or ffmpeg install needed.

```bash
npm install
npm run setup      # downloads whisper.cpp, the base.en model, Remotion's browser and yt-dlp (~200 MB)
npm run ui         # opens the drag-and-drop app at http://localhost:4321
```

On macOS/Linux, whisper.cpp is built from source during setup, so you need `cmake`, `make` and a C++ compiler
(macOS: `xcode-select --install` and `brew install cmake`).

## Command line

```bash
npm run generate-short --input=my_video.mp4
npm run generate-short --url="https://www.youtube.com/watch?v=..." -- --clip 0:00-1:00
```

See the header of `scripts/generate-short.ts` for all options. Finished videos land in `out/`.

## Notes

- YouTube sometimes asks for a login. In the app set "Browser login", or pass `--cookies-browser=firefox`.
- `npm run dev` opens Remotion Studio with a sample transcript for tweaking the design in `src/`.
- Only download videos you own or have permission to use.
