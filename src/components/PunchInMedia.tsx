import React, { useMemo } from "react";
import { AbsoluteFill, Easing, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { PunchIn } from "../lib/timeline";

/**
 * Scale for automatic camera punch-ins: a springy zoom on each beat, held briefly, then
 * eased back out just before the next beat so every punch reads as a fresh "cut".
 */
export function usePunchScale(punches: PunchIn[]) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const windows = useMemo(() => {
    const hold = Math.round(0.7 * fps);
    const maxRelaxEnd = Math.round(2.5 * fps);
    return punches.map((p, i) => {
      const next = punches[i + 1];
      const relaxEnd = Math.min(p.frame + maxRelaxEnd, next ? next.frame : Infinity);
      return { ...p, holdEnd: Math.min(p.frame + hold, relaxEnd - 1), relaxEnd };
    });
  }, [punches, fps]);

  let extra = 0;
  for (const w of windows) {
    if (w.frame > frame) break;
    if (frame > w.relaxEnd) continue;
    const punchIn = spring({ frame: frame - w.frame, fps, config: { damping: 15, stiffness: 200, mass: 0.6 } });
    const relax = interpolate(frame, [w.holdEnd, w.relaxEnd], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    });
    extra = Math.max(extra, (w.scale - 1) * punchIn * relax);
  }

  // Very slow push-in over the whole clip keeps quiet stretches from feeling static.
  const drift = interpolate(frame, [0, durationInFrames], [0, 0.025]);
  return 1 + extra + drift;
}

export const PunchInMedia: React.FC<{ punches: PunchIn[]; children: React.ReactNode }> = ({ punches, children }) => {
  const scale = usePunchScale(punches);
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: "50% 40%" }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};

export const CoverVideo: React.FC<{ src: string }> = ({ src }) => (
  <OffthreadVideo src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
);
