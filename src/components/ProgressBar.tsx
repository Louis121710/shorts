import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { hexToRgba } from "../lib/color";

/** Bottom progress bar that tracks playback, with a glowing leading edge. */
export const ProgressBar: React.FC<{ color: string; height?: number }> = ({ color, height = 12 }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();

  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const reveal = spring({ frame, fps, config: { damping: 200 }, durationInFrames: Math.round(0.6 * fps) });

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height,
        background: "rgba(255,255,255,0.18)",
        transform: `translateY(${(1 - reveal) * height * 3}px)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(90deg, ${hexToRgba(color, 0.7)}, ${color})`,
          boxShadow: `0 0 18px ${hexToRgba(color, 0.7)}`,
          transform: `scaleX(${progress})`, // sub-pixel smooth, unlike animating width
          transformOrigin: "left center",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: progress * width,
          width: height * 2,
          height: height * 2,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: `0 0 ${height * 2}px ${color}, 0 0 ${height}px ${color}`,
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
};
