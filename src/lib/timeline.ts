import type { Caption } from "../types";

export type TimedWord = {
  text: string;
  startFrame: number;
  endFrame: number;
  /** First word of a sentence, or first word after a noticeable pause. */
  isBeat: boolean;
};

export type CaptionChunk = {
  words: TimedWord[];
  startFrame: number;
  endFrame: number;
};

export type PunchIn = { frame: number; scale: number };

const SENTENCE_END = /[.!?…]["')\]]?$/;
const CLAUSE_END = /[,;:—–-]["')\]]?$/;

/** Pause (s) that forces a new caption chunk and counts as a punch-in beat. */
const PAUSE_SECONDS = 0.45;

export function captionsToWords(captions: Caption[], fps: number): TimedWord[] {
  const pauseFrames = Math.round(PAUSE_SECONDS * fps);
  const words: TimedWord[] = [];
  let prevText = "";
  let prevEnd = -Infinity;

  for (const c of captions) {
    const text = c.text.trim();
    if (!text) continue;
    const startFrame = Math.round((c.startMs / 1000) * fps);
    const endFrame = Math.max(startFrame + 1, Math.round((c.endMs / 1000) * fps));
    const isBeat = words.length === 0 || SENTENCE_END.test(prevText) || startFrame - prevEnd >= pauseFrames;
    words.push({ text, startFrame, endFrame, isBeat });
    prevText = text;
    prevEnd = endFrame;
  }

  // Keep a word highlighted until the next one starts, unless there's a real pause.
  words.forEach((w, i) => {
    const next = words[i + 1];
    if (next && next.startFrame - w.endFrame < pauseFrames) {
      w.endFrame = Math.max(w.endFrame, next.startFrame);
    }
  });

  return words;
}

/** Split n words into ceil(n / max) groups of near-equal size (e.g. 4 → 2+2, 7 → 3+2+2). */
function balancedSizes(n: number, max: number): number[] {
  const groups = Math.ceil(n / max);
  const base = Math.floor(n / groups);
  const extra = n % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

export function buildChunks(words: TimedWord[], fps: number, maxWords: number): CaptionChunk[] {
  // 1. Phrases: break on sentence starts, pauses and clause punctuation.
  const phrases: TimedWord[][] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (!prev || w.isBeat || CLAUSE_END.test(prev.text)) phrases.push([]);
    phrases[phrases.length - 1].push(w);
  });

  // 2. Each phrase → balanced chunks of at most `maxWords`.
  const chunks: CaptionChunk[] = [];
  for (const phrase of phrases) {
    let i = 0;
    for (const size of balancedSizes(phrase.length, Math.max(1, maxWords))) {
      const ws = phrase.slice(i, i + size);
      i += size;
      chunks.push({ words: ws, startFrame: ws[0].startFrame, endFrame: ws[ws.length - 1].endFrame });
    }
  }

  // 3. Hold each chunk until the next one (bounded), so captions don't flicker off between phrases.
  const maxHold = Math.round(0.5 * fps);
  chunks.forEach((c, i) => {
    const next = chunks[i + 1];
    c.endFrame = next
      ? Math.max(c.endFrame, Math.min(next.startFrame, c.endFrame + maxHold))
      : c.endFrame + maxHold;
  });

  return chunks;
}

/** Deterministic 0..1 pseudo-random value so renders are reproducible. */
function hash01(n: number) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Camera punch-ins on sentence starts / pauses: each beat gets its own zoom target
 * between 1 + 0.5×strength and 1 + strength (e.g. 1.05x–1.1x), varied but reproducible.
 */
export function buildPunchIns(words: TimedWord[], fps: number, strength: number): PunchIn[] {
  const minGap = Math.round(1.2 * fps);
  const punches: PunchIn[] = [];

  for (const w of words) {
    if (!w.isBeat) continue;
    const last = punches[punches.length - 1];
    if (last && w.startFrame - last.frame < minGap) continue;
    punches.push({ frame: w.startFrame, scale: 1 + strength * (0.5 + 0.5 * hash01(punches.length)) });
  }
  return punches;
}
