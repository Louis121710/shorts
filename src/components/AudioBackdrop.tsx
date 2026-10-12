import React from "react";
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from "remotion";
import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import { hexToRgba } from "../lib/color";

/** Background for audio-only inputs (or the preview with no media): drifting glow + spectrum bars. */
export const AudioBackdrop: React.FC<{ src: string | null; accent: string }> = ({ src, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const blobA = { x: 30 + 18 * Math.sin(t * 0.35), y: 30 + 10 * Math.cos(t * 0.27) };
  const blobB = { x: 70 + 15 * Math.cos(t * 0.31), y: 70 + 12 * Math.sin(t * 0.23) };

  return (
    <AbsoluteFill
      style={{
        background: `
          radial-gradient(60% 40% at ${blobA.x}% ${blobA.y}%, ${hexToRgba(accent, 0.22)} 0%, transparent 70%),
          radial-gradient(70% 45% at ${blobB.x}% ${blobB.y}%, rgba(90, 60, 255, 0.28) 0%, transparent 70%),
          linear-gradient(160deg, #101018 0%, #05050a 100%)
        `,
      }}
    >
      {src && (
        <>
          <Audio src={src} />
          <Spectrum src={src} accent={accent} />
        </>
      )}
    </AbsoluteFill>
  );
};

const Spectrum: React.FC<{ src: string; accent: string }> = ({ src, accent }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(src);
  if (!audioData) return null;

  const bins = visualizeAudio({ fps, frame, audioData, numberOfSamples: 32, optimizeFor: "speed" });
  // Mirror the low end for a symmetric shape.
  const bars = [...bins.slice(0, 16).reverse(), ...bins.slice(0, 16)];

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", top: "-18%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, height: 420 }}>
        {bars.map((v, i) => (
          <div
            key={i}
            style={{
              width: 18,
              height: 24 + Math.min(1, v * 4) * 380,
              borderRadius: 9,
              background: accent,
              boxShadow: `0 0 24px ${hexToRgba(accent, 0.6)}`,
              opacity: 0.85,
            }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};
