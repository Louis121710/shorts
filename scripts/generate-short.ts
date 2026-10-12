/**
 * One-shot pipeline: media file → local Whisper (whisper.cpp) word timestamps → Remotion render.
 *
 *   npm run generate-short --input=my_video.mp4
 *   npm run generate-short -- --input my_video.mp4 --model small.en --output out/final.mp4
 *
 * Options (all accept `--key=value`, `--key value`, or npm's `--key=value` before `--`):
 *   --cookies-browser  With --url: use this browser's YouTube login (chrome|edge|firefox|brave|…) to pass the "confirm you're not a bot" check
 *   --cookies-file     With --url: cookies.txt exported from a browser (alternative to --cookies-browser)
 *   --clip             With --url: only download this segment, e.g. 1:20-2:10 or 90-150
 *   --input            Video or audio file (required unless --url is given)
 *   --url              YouTube (or other) video link: downloads HD video + best audio first
 *   --output           Output .mp4 (default: out/<name>.mp4)
 *   --model            Whisper model: tiny(.en) | base(.en) | small(.en) | medium(.en) | large-v3 | large-v3-turbo  (default: base.en)
 *   --language         Spoken language code, e.g. en, es, de (default: en)
 *   --transcript       Use an existing transcript JSON instead of running Whisper
 *                      (@remotion/captions Caption[] or openai-whisper JSON with word_timestamps)
 *   --retranscribe     Ignore the cached transcript in out/ and run Whisper again
 *   --words-per-chunk  Max words per caption chunk (default: 3)
 *   --punch            Punch-in strength, 0.05–0.1 recommended (default: 0.1)
 *   --active-color     Colour of the spoken word, hex (default: #FFE600)
 *   --font-size        Caption font size in px (default: 104)
 *   --position         Caption vertical position, 0 = top … 1 = bottom (default: 0.6)
 *   --uppercase        true | false (default: true)
 *   --transcribe-only  Stop after writing the transcript JSON
 *   --concurrency      Passed through to `remotion render`
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  downloadWhisperModel,
  installWhisperCpp,
  transcribe,
  type TranscriptionJson,
  type WhisperModel,
} from "@remotion/install-whisper-cpp";
import type { Caption } from "@remotion/captions";
import { downloadVideo } from "./yt";
import { defaultCaptionStyle, type MediaType, type ShortProps } from "../src/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WHISPER_VERSION = "1.5.5"; // Remotion-hosted Windows build; supports --dtw token timestamps
const WHISPER_DIR = path.join(ROOT, ".whisper", "whisper.cpp");
const MODEL_DIR = path.join(ROOT, ".whisper", "models");
const CACHE_DIR = path.join(ROOT, ".cache");
const OUT_DIR = path.join(ROOT, "out");
// Renders use their own small public dir so unrelated files in /public never get copied into every render.
const RENDER_PUBLIC = path.join(ROOT, ".render-public");
const PUBLIC_INPUTS = path.join(RENDER_PUBLIC, "inputs");
const REMOTION_CLI = path.join(ROOT, "node_modules", "@remotion", "cli", "remotion-cli.js");

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"]);

/* --------------------------------- Args ---------------------------------- */
function parseArgs(argv: string[]) {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      if (!out.input) out.input = a; // allow a bare positional input path
      continue;
    }
    const [k, v] = a.slice(2).split(/=(.*)/s, 2);
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}

const cliArgs = parseArgs(process.argv.slice(2));

/** Reads `--key` from the CLI, falling back to npm's `npm_config_key` (from `npm run x --key=value`). */
function arg(key: string): string | undefined {
  const v = cliArgs[key];
  if (typeof v === "string") return v;
  if (v === true) return "true";
  const env = process.env[`npm_config_${key.replace(/-/g, "_")}`] ?? process.env[`npm_config_${key}`];
  return env === undefined || env === "" ? undefined : env;
}
const flag = (key: string) => {
  const v = arg(key);
  return v !== undefined && v !== "false";
};

/* -------------------------------- Helpers -------------------------------- */
/** Prints a progress label only when the 10% bucket changes (avoids thousands of lines). */
const tick = (label: string) => {
  let last = -1;
  return (fraction: number) => {
    const pct = Math.floor(fraction * 10) * 10;
    if (pct !== last) process.stdout.write(`  ${label} ${(last = pct)}%
`);
  };
};

/** Forwards yt-dlp output, thinning the per-line download progress to every 10%. */
const tickDownload = () => {
  let last = -1;
  return (line: string) => {
    const m = /^\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
    if (!m) return void console.log(line);
    const pct = Math.floor(parseFloat(m[1]) / 10) * 10;
    if (pct !== last) console.log(`  downloading video ${(last = pct)}%`);
  };
};

const log = (msg: string) => console.log(`\x1b[33m▶\x1b[0m ${msg}`);

function run(cmd: string, args: string[], opts: { capture?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit" });
    let stdout = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(cmd)} ${args[1] ?? ""} exited with code ${code}`)),
    );
  });
}

/** Remotion ships its own ffmpeg/ffprobe, so no system install is needed. */
const remotion = (args: string[], opts?: { capture?: boolean }) => run(process.execPath, [REMOTION_CLI, ...args], opts);

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "short";

const isNewer = (a: string, b: string) => fs.existsSync(a) && fs.statSync(a).mtimeMs >= fs.statSync(b).mtimeMs;

/** Reads stream info with Remotion's bundled ffprobe. */
async function probeMedia(file: string): Promise<{ hasAudio: boolean; duration: number | null }> {
  const streams = await remotion(
    ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file],
    { capture: true },
  );
  const dur = await remotion(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { capture: true },
  );
  return { hasAudio: /audio/.test(streams), duration: parseFloat(dur.trim()) || null };
}

/* ------------------------- Whisper → word captions ------------------------ */
const SPECIAL_TOKEN = /^\s*(\[_[A-Z]+_?\d*\]|<\|.*\|>)\s*$/;
const NON_SPEECH = /^[[(].*[\])]$/; // "[MUSIC]", "(laughs)"

/** Merge whisper.cpp sub-word tokens into words (a token without a leading space continues the previous word). */
function whisperCppToWords(json: TranscriptionJson<true>): Caption[] {
  const words: Caption[] = [];
  for (const item of json.transcription) {
    for (const tok of item.tokens) {
      if (!tok.text || SPECIAL_TOKEN.test(tok.text)) continue;
      const startsWord = /^\s/.test(tok.text) || words.length === 0;
      const prev = words[words.length - 1];
      if (startsWord || !prev) {
        words.push({
          text: words.length === 0 ? tok.text.trimStart() : tok.text,
          startMs: tok.offsets.from,
          endMs: tok.offsets.to,
          timestampMs: tok.t_dtw === -1 ? null : tok.t_dtw * 10,
          confidence: tok.p,
        });
      } else {
        prev.text += tok.text;
        prev.endMs = Math.max(prev.endMs, tok.offsets.to);
        prev.confidence = Math.min(prev.confidence ?? 1, tok.p);
      }
    }
  }
  return cleanWords(words);
}

/** Accepts Caption[] or openai-whisper JSON (`segments[].words[]` with seconds). */
function normalizeTranscript(raw: unknown): Caption[] {
  if (Array.isArray(raw)) return cleanWords(raw as Caption[]);
  const r = raw as { segments?: { words?: { word: string; start: number; end: number; probability?: number }[] }[] };
  if (r?.segments) {
    const words = r.segments.flatMap((s) => s.words ?? []);
    if (!words.length) throw new Error("Transcript has no word-level timestamps (run whisper with word_timestamps=True).");
    return cleanWords(
      words.map((w) => ({
        text: w.word,
        startMs: Math.round(w.start * 1000),
        endMs: Math.round(w.end * 1000),
        timestampMs: null,
        confidence: w.probability ?? null,
      })),
    );
  }
  throw new Error("Unrecognised transcript format.");
}

function cleanWords(words: Caption[]): Caption[] {
  const out: Caption[] = [];
  for (const w of words) {
    const text = w.text.trim();
    if (!text || NON_SPEECH.test(text) || /^[^\p{L}\p{N}]+$/u.test(text)) {
      // Stray punctuation token: glue it onto the previous word.
      if (out.length && text && !NON_SPEECH.test(text)) out[out.length - 1].text += text;
      continue;
    }
    const prev = out[out.length - 1];
    const startMs = Math.max(w.startMs, prev ? prev.startMs : 0);
    out.push({ ...w, text: (out.length ? " " : "") + text, startMs, endMs: Math.max(w.endMs, startMs + 40) });
  }
  repairCollapsedWords(out);
  return out;
}

/**
 * whisper.cpp sometimes gives a word a ~0ms slot that starts together with the next word,
 * which would highlight both at once. Stretch such words back to the end of the previous word.
 */
function repairCollapsedWords(words: Caption[]) {
  for (let i = 0; i < words.length - 1; i++) {
    const next = words[i + 1];
    if (next.startMs - words[i].startMs >= 100) continue;
    const floor = i > 0 ? words[i - 1].endMs : 0;
    if (floor < next.startMs - 60) {
      words[i].startMs = floor;
      words[i].endMs = next.startMs;
    }
  }
}

async function runWhisper(input: string, slug: string): Promise<Caption[]> {
  const language = (arg("language") ?? "en").toLowerCase();
  let model = (arg("model") ?? "base.en") as WhisperModel;
  if (language !== "en" && model.endsWith(".en")) model = model.replace(/\.en$/, "") as WhisperModel;

  fs.mkdirSync(path.dirname(WHISPER_DIR), { recursive: true });
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  log(`Ensuring whisper.cpp ${WHISPER_VERSION} and model "${model}" are installed (first run downloads them)…`);
  await installWhisperCpp({ version: WHISPER_VERSION, to: WHISPER_DIR, printOutput: false });
  await downloadWhisperModel({
    model,
    folder: MODEL_DIR,
    printOutput: false,
    onProgress: ((t) => (d: number, total: number) => t(d / total))(tick("model download")),
  });
  process.stdout.write("\n");

  const wav = path.join(CACHE_DIR, `${slug}.16k.wav`);
  log("Extracting 16 kHz mono audio…");
  await remotion(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);

  log(`Transcribing with Whisper (${model}, ${language})…`);
  const json = await transcribe({
    inputPath: wav,
    whisperPath: WHISPER_DIR,
    whisperCppVersion: WHISPER_VERSION,
    model,
    modelFolder: MODEL_DIR,
    tokenLevelTimestamps: true,
    language: language as never,
    splitOnWord: true,
    printOutput: false,
    onProgress: tick("transcribing"),
  });
  process.stdout.write("\n");
  fs.rmSync(wav, { force: true });
  return whisperCppToWords(json);
}

/* ---------------------------------- Main --------------------------------- */
async function main() {
  const urlArg = arg("url");
  const inputArg = arg("input");
  let input: string;
  if (urlArg && urlArg !== "true") {
    log(`Downloading ${urlArg} (best quality up to 1080p, with audio)…`);
    input = await downloadVideo(urlArg, path.join(ROOT, "uploads"), tickDownload(), {
      clip: arg("clip"),
      cookiesBrowser: arg("cookies-browser"),
      cookiesFile: arg("cookies-file") ? path.resolve(process.env.INIT_CWD ?? process.cwd(), arg("cookies-file")!) : undefined,
    });
    log(`Downloaded → ${path.relative(ROOT, input)}`);
  } else {
    if (!inputArg || inputArg === "true") {
      console.error("Usage: npm run generate-short --input=my_video.mp4  (or --url=<YouTube link>)  — see scripts/generate-short.ts for options");
      process.exit(1);
    }
    // npm runs scripts from the package root; resolve relative to where the user invoked npm.
    input = path.resolve(process.env.INIT_CWD ?? process.cwd(), inputArg);
    if (!fs.existsSync(input)) throw new Error(`Input not found: ${input}`);
  }

  const ext = path.extname(input).toLowerCase();
  const mediaType: MediaType | null = VIDEO_EXT.has(ext) ? "video" : AUDIO_EXT.has(ext) ? "audio" : null;
  if (!mediaType) throw new Error(`Unsupported file type "${ext}".`);

  const info = await probeMedia(input);
  if (!info.hasAudio) {
    throw new Error(
      "This file has no audio track, so there is nothing to transcribe. It is probably a video-only download " +
        '(e.g. a "video only" stream from YouTube). Download a version that includes audio, or merge audio into it first.',
    );
  }
  if (info.duration && info.duration > 180) {
    log(`Warning: this is ${(info.duration / 60).toFixed(1)} minutes long. Shorts are normally under 3 minutes, and rendering at 60 FPS will take a long time.`);
  }

  const slug = slugify(path.basename(input, ext));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const captionsPath = path.join(OUT_DIR, `${slug}.captions.json`);

  // 1. Transcript
  let captions: Caption[];
  const transcriptArg = arg("transcript");
  if (transcriptArg) {
    const p = path.resolve(process.env.INIT_CWD ?? process.cwd(), transcriptArg);
    log(`Using provided transcript ${p}`);
    captions = normalizeTranscript(JSON.parse(fs.readFileSync(p, "utf8")));
  } else if (!flag("retranscribe") && isNewer(captionsPath, input)) {
    log(`Reusing cached transcript ${path.relative(ROOT, captionsPath)} (pass --retranscribe to redo)`);
    captions = JSON.parse(fs.readFileSync(captionsPath, "utf8"));
  } else {
    captions = await runWhisper(input, slug);
  }
  if (!captions.length) throw new Error("Transcript is empty — no speech detected.");
  fs.writeFileSync(captionsPath, JSON.stringify(captions, null, 2));
  log(`Transcript: ${captions.length} words → ${path.relative(ROOT, captionsPath)}`);
  if (flag("transcribe-only")) return;

  // 2. Stage media in /public so the composition can load it via staticFile()
  fs.rmSync(PUBLIC_INPUTS, { recursive: true, force: true }); // only keep the current video
  fs.mkdirSync(PUBLIC_INPUTS, { recursive: true });
  const staged = path.join(PUBLIC_INPUTS, `${slug}${ext}`);
  if (!fs.existsSync(staged) || fs.statSync(staged).size !== fs.statSync(input).size) fs.copyFileSync(input, staged);

  const durationInSeconds = info.duration;

  const props: ShortProps = {
    mediaSrc: `inputs/${slug}${ext}`,
    mediaType,
    captions,
    durationInSeconds,
    punchInStrength: Number(arg("punch") ?? 0.1),
    captionStyle: {
      ...defaultCaptionStyle,
      maxWordsPerChunk: Number(arg("words-per-chunk") ?? defaultCaptionStyle.maxWordsPerChunk),
      activeColor: arg("active-color") ?? defaultCaptionStyle.activeColor,
      fontSize: Number(arg("font-size") ?? defaultCaptionStyle.fontSize),
      verticalPosition: Number(arg("position") ?? defaultCaptionStyle.verticalPosition),
      uppercase: arg("uppercase") !== "false",
    },
  };
  const propsPath = path.join(OUT_DIR, `${slug}.props.json`);
  fs.writeFileSync(propsPath, JSON.stringify(props));

  // 3. Render
  const outputArg = arg("output");
  const output = outputArg ? path.resolve(process.env.INIT_CWD ?? process.cwd(), outputArg) : path.join(OUT_DIR, `${slug}.mp4`);
  log(`Rendering ${durationInSeconds?.toFixed(1) ?? "?"}s @ 1080x1920 60fps → ${output}`);
  const concurrency = arg("concurrency");
  await remotion([
    "render",
    `--public-dir=${RENDER_PUBLIC}`,
    "src/index.ts",
    "Short",
    output,
    `--props=${propsPath}`,
    ...(concurrency ? [`--concurrency=${concurrency}`] : []),
  ]);
  log(`Done: ${output}`);
}

main().catch((err) => {
  console.error(`\x1b[31m✖ ${err instanceof Error ? err.message : err}\x1b[0m`);
  process.exit(1);
});
