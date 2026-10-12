import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

/** Dark top/bottom gradients so UI and captions stay legible over any footage. */
export const GradientOverlays: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, Math.round(0.5 * fps)], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "24%",
          background: "linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.25) 50%, rgba(0,0,0,0) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "55%",
          background:
            "linear-gradient(0deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.45) 35%, rgba(0,0,0,0.15) 70%, rgba(0,0,0,0) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
