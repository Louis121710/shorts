/** YouTube (and other sites) download via yt-dlp, with the exe fetched on demand. */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS_DIR = path.join(ROOT, ".tools");
const IS_WIN = process.platform === "win32";
const YTDLP = path.join(TOOLS_DIR, IS_WIN ? "yt-dlp.exe" : "yt-dlp");
const RELEASE_BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";

export function isHttpUrl(s: string) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export async function ensureYtDlp(onLine: (l: string) => void): Promise<string> {
  if (fs.existsSync(YTDLP)) return YTDLP;
  const asset = IS_WIN ? "yt-dlp.exe" : process.platform === "darwin" ? "yt-dlp_macos" : "yt-dlp_linux";
  onLine("Downloading yt-dlp (one time, ~18 MB)…");
  const res = await fetch(RELEASE_BASE + asset);
  if (!res.ok) throw new Error(`Could not download yt-dlp (HTTP ${res.status}).`);
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  fs.writeFileSync(YTDLP, Buffer.from(await res.arrayBuffer()));
  if (!IS_WIN) fs.chmodSync(YTDLP, 0o755);
  return YTDLP;
}

/** Directory holding Remotion's bundled ffmpeg (yt-dlp needs it to merge video + audio). */
function ffmpegDir(): string {
  const base = path.join(ROOT, "node_modules", "@remotion");
  for (const d of fs.readdirSync(base)) {
    if (!d.startsWith("compositor-")) continue;
    const dir = path.join(base, d);
    if (fs.existsSync(path.join(dir, IS_WIN ? "ffmpeg.exe" : "ffmpeg"))) return dir;
  }
  throw new Error("Remotion's bundled ffmpeg was not found. Run `npm install` again.");
}

function runYtDlp(exe: string, args: string[], onLine: (l: string) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: ROOT });
    const feed = (chunk: Buffer) => {
      for (const raw of chunk.toString().split(/\r?\n|\r/)) if (raw.trim()) onLine(raw.trimEnd());
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/**
 * Downloads the best-quality video (up to 1080p, H.264 preferred so it decodes everywhere) plus the
 * best audio, merged into one .mp4 inside `destDir`. Returns the file path.
 */
export type DownloadOptions = {
  /** "start-end" segment, e.g. "1:20-2:10". */
  clip?: string;
  /** Browser whose signed-in YouTube session yt-dlp may use: chrome | edge | firefox | brave | opera | vivaldi | chromium. */
  cookiesBrowser?: string;
  /** Path to a Netscape-format cookies.txt (alternative to cookiesBrowser). */
  cookiesFile?: string;
};

const BROWSERS = new Set(["chrome", "edge", "firefox", "brave", "opera", "vivaldi", "chromium"]);

export async function downloadVideo(url: string, destDir: string, onLine: (l: string) => void, opts: DownloadOptions = {}): Promise<string> {
  const { clip, cookiesBrowser, cookiesFile } = opts;
  if (cookiesBrowser && !BROWSERS.has(cookiesBrowser)) throw new Error(`Unsupported browser "${cookiesBrowser}".`);
  if (cookiesFile && !fs.existsSync(cookiesFile)) throw new Error(`Cookies file not found: ${cookiesFile}`);
  if (!isHttpUrl(url)) throw new Error("That doesn't look like a valid link. Paste a full https:// video URL.");
  const exe = await ensureYtDlp(onLine);
  fs.mkdirSync(destDir, { recursive: true });
  const record = path.join(TOOLS_DIR, `last-download-${process.pid}.txt`);
  fs.rmSync(record, { force: true });

  // Optional "start-end" segment, e.g. "1:20-2:10" or "90-150"; keeps the download (and render) short.
  if (clip && !/^[\d:.]+-[\d:.]+$/.test(clip)) throw new Error('Clip must look like "1:20-2:10" (start-end).');
  const clipArgs = clip ? ["--download-sections", `*${clip}`, "--force-keyframes-at-cuts"] : [];

  const args = [
    ...clipArgs,
    ...(cookiesBrowser ? ["--cookies-from-browser", cookiesBrowser] : cookiesFile ? ["--cookies", cookiesFile] : []),
    "--no-playlist",
    "--newline",
    "--no-warnings",
    "-f", "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
    "-S", "res:1080,vcodec:h264,acodec:aac",
    "--merge-output-format", "mp4",
    "--ffmpeg-location", ffmpegDir(),
    "--js-runtimes", "node",
    "-o", path.join(destDir, clip ? `yt-%(id)s-${clip.replace(/[^\d]+/g, "_")}.%(ext)s` : "yt-%(id)s.%(ext)s"),
    "--print-to-file", "after_move:filepath", record,
    url,
  ];

  let lastError = "";
  const watch = (l: string) => {
    if (l.startsWith("ERROR:")) lastError = l.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, "");
    onLine(l);
  };
  let code = await runYtDlp(exe, args, watch);
  if (code !== 0) {
    // YouTube changes often; a stale yt-dlp is the usual cause. Update once and retry.
    onLine("Download failed. Updating yt-dlp and retrying…");
    await runYtDlp(exe, ["-U"], onLine);
    code = await runYtDlp(exe, args, watch);
  }
  if (code !== 0 || !fs.existsSync(record)) {
    const botCheck = /sign in to confirm|not a bot/i.test(lastError);
    const rateLimited = /429|too many requests/i.test(lastError);
    const cookieProblem = /cookie|DPAPI|decrypt|database/i.test(lastError);
    const reason = botCheck
      ? "YouTube wants proof you're not a bot for this video. " +
        (cookiesBrowser || cookiesFile
          ? "The login you provided wasn't accepted; make sure you're signed in to YouTube in that browser."
          : 'In the app, set "Browser login" to a browser where you are signed in to YouTube (Firefox is the most reliable), then try again.')
      : rateLimited
        ? "YouTube is temporarily rate-limiting this connection, so wait a few minutes and try again."
        : cookieProblem
          ? "Couldn't read that browser's cookies. Close the browser completely and retry, or pick Firefox."
          : "Check the link (private, age-restricted, or region-locked videos can fail).";
    throw new Error(`Could not download that video. ${reason}`);
  }
  const file = fs.readFileSync(record, "utf8").trim().split(/\r?\n/).pop()!;
  fs.rmSync(record, { force: true });
  if (!fs.existsSync(file)) throw new Error("Download finished but the file was not found.");
  return file;
}
