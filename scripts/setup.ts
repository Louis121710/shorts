/** One-time setup: downloads whisper.cpp, the Whisper model and Remotion's headless browser. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadWhisperModel, installWhisperCpp, type WhisperModel } from "@remotion/install-whisper-cpp";
import { ensureBrowser } from "@remotion/renderer";
import { ensureYtDlp } from "./yt";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WHISPER_VERSION = "1.5.5";
/** Prints a progress label only when the 10% bucket changes (avoids thousands of lines). */
const tick = (label: string) => {
  let last = -1;
  return (fraction: number) => {
    const pct = Math.floor(fraction * 10) * 10;
    if (pct !== last) process.stdout.write(`  ${label} ${(last = pct)}%
`);
  };
};
const modelTick = ((t) => (d: number, total: number) => t(d / total))(tick("model"));
const model = (process.argv[2] ?? "base.en") as WhisperModel;

fs.mkdirSync(path.join(ROOT, ".whisper", "models"), { recursive: true });

console.log("▶ Installing whisper.cpp…");
await installWhisperCpp({ version: WHISPER_VERSION, to: path.join(ROOT, ".whisper", "whisper.cpp"), printOutput: true });

console.log(`▶ Downloading Whisper model "${model}"…`);
await downloadWhisperModel({
  model,
  folder: path.join(ROOT, ".whisper", "models"),
  printOutput: false,
  onProgress: modelTick,
});

console.log("\n▶ Ensuring Remotion headless browser…");
await ensureBrowser();
console.log("▶ Ensuring yt-dlp (YouTube downloads)…");
await ensureYtDlp(console.log);
console.log("✔ Setup complete.");
