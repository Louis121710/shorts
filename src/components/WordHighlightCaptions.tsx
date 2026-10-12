import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { hexToRgba } from "../lib/color";
import { captionFontFamily } from "../lib/fonts";
import { buildChunks, captionsToWords, type CaptionChunk, type TimedWord } from "../lib/timeline";
import { defaultCaptionStyle, type Caption, type CaptionStyle } from "../types";

export type WordHighlightCaptionsProps = {
  /** Word-level captions, one entry per word (`@remotion/captions` format). */
  captions: Caption[];
  style?: Partial<CaptionStyle>;
};

/** Hormozi / CapCut-style captions: 2–3 word chunks, the spoken word pops (1.15x) in neon yellow. */
export const WordHighlightCaptions: React.FC<WordHighlightCaptionsProps> = ({ captions, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s: CaptionStyle = { ...defaultCaptionStyle, ...style };

  const chunks = useMemo(
    () => buildChunks(captionsToWords(captions, fps), fps, s.maxWordsPerChunk),
    [captions, fps, s.maxWordsPerChunk],
  );

  // Exactly one chunk on screen at a time.
  let active: CaptionChunk | null = null;
  for (const c of chunks) {
    if (c.startFrame > frame) break;
    if (frame < c.endFrame) active = c;
  }
  if (!active) return null;

  return <ChunkView key={active.startFrame} chunk={active} style={s} />;
};

const ChunkView: React.FC<{ chunk: CaptionChunk; style: CaptionStyle }> = ({ chunk, style }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();

  const enter = spring({
    frame: frame - chunk.startFrame,
    fps,
    config: { damping: 14, stiffness: 260, mass: 0.6 },
  });
  const exit = interpolate(frame, [chunk.endFrame - Math.round(0.1 * fps), chunk.endFrame], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: "5%",
          right: "5%",
          top: height * style.verticalPosition,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "center",
          rowGap: style.fontSize * 0.05,
          fontFamily: captionFontFamily,
          fontWeight: 900,
          fontSize: style.fontSize,
          lineHeight: 1.1,
          letterSpacing: "-0.01em",
          textAlign: "center",
          textTransform: style.uppercase ? "uppercase" : "none",
          opacity: Math.min(1, enter) * exit,
          transform: `translateY(-50%) translateY(${interpolate(enter, [0, 1], [24, 0])}px) scale(${interpolate(enter, [0, 1], [0.8, 1])})`,
        }}
      >
        {chunk.words.map((w, i) => (
          <Word key={`${w.startFrame}-${i}`} word={w} style={style} />
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Word: React.FC<{ word: TimedWord; style: CaptionStyle }> = ({ word, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const popIn = spring({
    frame: frame - word.startFrame,
    fps,
    config: { damping: 10, stiffness: 280, mass: 0.55 }, // snappy with a little overshoot
  });
  const popOut = spring({
    frame: frame - word.endFrame,
    fps,
    config: { damping: 20, stiffness: 240, mass: 0.6 }, // settles without bounce
  });

  const activeness = popIn - popOut; // 0 → ~1 (overshoot) → 0
  const t = Math.min(1, Math.max(0, activeness));
  const scale = 1 + 0.15 * activeness; // 1.15x while spoken
  const fs = style.fontSize;

  return (
    <span
      style={{
        position: "relative",
        zIndex: t > 0 ? 1 : 0,
        display: "inline-block",
        margin: `0 ${fs * 0.14}px`,
        color: interpolateColors(t, [0, 1], [style.baseColor, style.activeColor]),
        transform: `scale(${scale}) rotate(${-2 * t}deg)`,
        transformOrigin: "50% 65%",
        WebkitTextStroke: `${fs * 0.16}px #000`,
        paintOrder: "stroke fill",
        textShadow: [
          `0 ${fs * 0.08}px 0 #000`, // hard drop shadow
          `0 ${fs * 0.1}px ${fs * 0.3}px rgba(0,0,0,0.65)`,
          `0 0 ${fs * 0.35 * t}px ${hexToRgba(style.activeColor, 0.45 * t)}`, // neon glow on the active word
        ].join(", "),
      }}
    >
      {word.text}
    </span>
  );
};
