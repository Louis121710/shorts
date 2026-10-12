import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  OffthreadVideo,
  interpolate,
  interpolateColors,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/* ----------------------------- Whisper types ----------------------------- */
// Matches OpenAI Whisper output with `word_timestamps=True`
export type WhisperWord = { word: string; start: number; end: number; probability?: number };
export type WhisperSegment = { id?: number; start: number; end: number; text: string; words?: WhisperWord[] };
export type WhisperTranscript = { text?: string; segments: WhisperSegment[] };

export type CapCutStyleSubtitlesProps = {
  transcript: WhisperTranscript;
  videoSrc: string;
  maxWordsPerPage?: number;
  activeColor?: string;
  baseColor?: string;
  fontFamily?: string;
  fontSize?: number;
  captionBottomOffset?: number; // px from bottom of frame
};

/* ---------------------------- Internal types ----------------------------- */
type Word = { text: string; startFrame: number; endFrame: number; sentenceStart: boolean };
type Page = { words: Word[]; startFrame: number; endFrame: number };
type Sentence = { startFrame: number; endFrame: number };

const SENTENCE_END = /[.!?…]["')\]]?$/;

/* ------------------------- Transcript -> timeline ------------------------ */
function buildTimeline(transcript: WhisperTranscript, fps: number, maxWordsPerPage: number) {
  const gapFrames = Math.round(0.6 * fps); // pause that forces a new caption page
  const words: Word[] = [];
  let nextIsSentenceStart = true;

  for (const seg of transcript.segments) {
    for (const w of seg.words ?? []) {
      const text = w.word.trim(); // Whisper words carry leading spaces
      if (!text) continue;
      const startFrame = Math.round(w.start * fps);
      const endFrame = Math.max(startFrame + 1, Math.round(w.end * fps));
      words.push({ text, startFrame, endFrame, sentenceStart: nextIsSentenceStart });
      nextIsSentenceStart = SENTENCE_END.test(text);
    }
  }

  // Keep the highlight on a word until the next one starts (no "dead" frames mid-phrase)
  words.forEach((w, i) => {
    const next = words[i + 1];
    if (next && next.startFrame - w.endFrame <= gapFrames) {
      w.endFrame = Math.max(w.endFrame, next.startFrame);
    }
  });

  // Sentences (drive the background punch-ins)
  const sentences: Sentence[] = [];
  for (const w of words) {
    if (w.sentenceStart || sentences.length === 0) {
      sentences.push({ startFrame: w.startFrame, endFrame: w.endFrame });
    } else {
      sentences[sentences.length - 1].endFrame = w.endFrame;
    }
  }

  // Pages: break on sentence start, max words, or a long pause
  const pages: Page[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (!current.length) return;
    pages.push({
      words: current,
      startFrame: current[0].startFrame,
      endFrame: current[current.length - 1].endFrame,
    });
    current = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const longPause = prev && w.startFrame - prev.endFrame > gapFrames;
    if (current.length && (w.sentenceStart || current.length >= maxWordsPerPage || longPause)) flush();
    current.push(w);
  });
  flush();

  // Hold each page until the next one (or a short tail), to avoid flicker
  pages.forEach((p, i) => {
    const next = pages[i + 1];
    p.endFrame = next
      ? Math.max(p.endFrame, Math.min(next.startFrame, p.endFrame + gapFrames))
      : p.endFrame + Math.round(0.4 * fps);
  });

  return { sentences, pages };
}

/* ------------------------- Background punch-in zoom ---------------------- */
const PunchInBackground: React.FC<{ src: string; sentences: Sentence[] }> = ({ src, sentences }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const holdFrames = Math.round(0.35 * fps);
  const minRelax = Math.round(0.4 * fps);

  // Max of every sentence's contribution => continuous, never jumps
  let punch = 0;
  for (const s of sentences) {
    if (s.startFrame > frame) break;
    const holdEnd = s.startFrame + holdFrames;
    const relaxEnd = Math.max(holdEnd + minRelax, s.endFrame);
    if (frame > relaxEnd) continue;

    const punchIn = spring({
      frame: frame - s.startFrame,
      fps,
      config: { damping: 14, stiffness: 160, mass: 0.7 }, // tiny overshoot = "punch"
    });
    const relax = interpolate(frame, [holdEnd, relaxEnd], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    });
    punch = Math.max(punch, punchIn * relax);
  }

  const scale = 1 + 0.05 * punch;

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: "50% 45%" }}>
        <OffthreadVideo src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ------------------------------ Top gradient ----------------------------- */
const TopGradient: React.FC<{ accent: string }> = ({ accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const fadeIn = interpolate(frame, [0, Math.round(0.4 * fps)], [0, 1], { extrapolateRight: "clamp" });
  const darkness = 0.55 + 0.07 * Math.sin(t * 1.1);        // slow "breathing"
  const glowX = 50 + 22 * Math.sin(t * 0.45);               // drifting accent glow
  const glowAlpha = 0.1 + 0.04 * Math.sin(t * 0.8 + 1);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: fadeIn }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "30%",
          background: `
            radial-gradient(120% 90% at ${glowX}% 0%, ${hexToRgba(accent, glowAlpha)} 0%, transparent 60%),
            linear-gradient(180deg, rgba(0,0,0,${darkness}) 0%, rgba(0,0,0,0) 100%)
          `,
        }}
      />
    </AbsoluteFill>
  );
};

/* ------------------------------ Progress bar ----------------------------- */
const ProgressBar: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], { extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 10,
        background: "rgba(255,255,255,0.18)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          background: color,
          boxShadow: `0 0 16px ${hexToRgba(color, 0.8)}`,
          transform: `scaleX(${progress})`, // sub-pixel smooth, unlike width %
          transformOrigin: "left center",
        }}
      />
    </div>
  );
};

/* ------------------------------ Karaoke word ----------------------------- */
const KaraokeWord: React.FC<{
  word: Word;
  activeColor: string;
  baseColor: string;
}> = ({ word, activeColor, baseColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const popIn = spring({
    frame: Math.max(0, frame - word.startFrame),
    fps,
    config: { damping: 10, stiffness: 220, mass: 0.6 }, // bouncy
  });
  const popOut = spring({
    frame: Math.max(0, frame - word.endFrame),
    fps,
    config: { damping: 18, stiffness: 200, mass: 0.6 }, // settles cleanly
  });

  const activeness = popIn - popOut;                       // 0 → ~1 (overshoots) → 0
  const colorT = Math.min(1, Math.max(0, activeness));
  const scale = 1 + 0.15 * activeness;                      // peaks at 1.15× with bounce
  const color = interpolateColors(colorT, [0, 1], [baseColor, activeColor]);
  const glow = hexToRgba(activeColor, 0.55 * colorT);

  return (
    <span
      style={{
        display: "inline-block",
        margin: "0 0.12em",
        color,
        transform: `scale(${scale}) translateY(${-6 * colorT}px)`,
        transformOrigin: "50% 60%",
        WebkitTextStroke: "12px #000",
        paintOrder: "stroke fill",
        textShadow: `
          0 6px 0 #000,
          0 10px 28px rgba(0,0,0,0.7),
          0 0 ${24 * colorT}px ${glow}
        `,
      }}
    >
      {word.text}
    </span>
  );
};

/* ------------------------------ Caption page ----------------------------- */
const CaptionPage: React.FC<{
  page: Page;
  activeColor: string;
  baseColor: string;
  fontFamily: string;
  fontSize: number;
  bottom: number;
}> = ({ page, activeColor, baseColor, fontFamily, fontSize, bottom }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame: Math.max(0, frame - page.startFrame),
    fps,
    config: { damping: 200 },
    durationInFrames: Math.round(0.2 * fps),
  });
  const exit = interpolate(frame, [page.endFrame - Math.round(0.08 * fps), page.endFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", pointerEvents: "none" }}>
      <div
        style={{
          marginBottom: bottom,
          maxWidth: "86%",
          textAlign: "center",
          fontFamily,
          fontSize,
          fontWeight: 900,
          lineHeight: 1.15,
          textTransform: "uppercase",
          letterSpacing: "0.01em",
          opacity: enter * exit,
          transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px) scale(${interpolate(enter, [0, 1], [0.92, 1])})`,
        }}
      >
        {page.words.map((w, i) => (
          <KaraokeWord key={`${w.startFrame}-${i}`} word={w} activeColor={activeColor} baseColor={baseColor} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* ------------------------------ Main component --------------------------- */
export const CapCutStyleSubtitles: React.FC<CapCutStyleSubtitlesProps> = ({
  transcript,
  videoSrc,
  maxWordsPerPage = 4,
  activeColor = "#FFE600",
  baseColor = "#FFFFFF",
  fontFamily = '"Montserrat", "Inter", system-ui, sans-serif',
  fontSize = 88,
  captionBottomOffset = 420,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const { sentences, pages } = useMemo(
    () => buildTimeline(transcript, fps, maxWordsPerPage),
    [transcript, fps, maxWordsPerPage]
  );

  // Only one page on screen at a time
  let activePage: Page | null = null;
  for (const p of pages) {
    if (p.startFrame > frame) break;
    if (frame < p.endFrame) activePage = p;
  }

  return (
    <AbsoluteFill>
      <PunchInBackground src={videoSrc} sentences={sentences} />
      <TopGradient accent={activeColor} />
      {activePage && (
        <CaptionPage
          page={activePage}
          activeColor={activeColor}
          baseColor={baseColor}
          fontFamily={fontFamily}
          fontSize={fontSize}
          bottom={captionBottomOffset}
        />
      )}
      <ProgressBar color={activeColor} />
    </AbsoluteFill>
  );
};

/* -------------------------------- Helpers -------------------------------- */
function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}