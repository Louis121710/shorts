import React, { useMemo } from "react";
import { AbsoluteFill, staticFile, useVideoConfig } from "remotion";
import { AudioBackdrop } from "./components/AudioBackdrop";
import { GradientOverlays } from "./components/GradientOverlays";
import { ProgressBar } from "./components/ProgressBar";
import { CoverVideo, PunchInMedia } from "./components/PunchInMedia";
import { WordHighlightCaptions } from "./components/WordHighlightCaptions";
import { buildPunchIns, captionsToWords } from "./lib/timeline";
import { defaultCaptionStyle, type ShortProps } from "./types";

export const resolveMediaSrc = (src: string) => (/^(https?:|data:|blob:)/.test(src) ? src : staticFile(src));

export const Short: React.FC<ShortProps> = ({ mediaSrc, mediaType, captions, punchInStrength, captionStyle }) => {
  const { fps } = useVideoConfig();
  const style = { ...defaultCaptionStyle, ...captionStyle };
  const src = mediaSrc ? resolveMediaSrc(mediaSrc) : null;

  const punches = useMemo(
    () => buildPunchIns(captionsToWords(captions, fps), fps, punchInStrength),
    [captions, fps, punchInStrength],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <PunchInMedia punches={punches}>
        {src && mediaType === "video" ? <CoverVideo src={src} /> : <AudioBackdrop src={src} accent={style.activeColor} />}
      </PunchInMedia>
      <GradientOverlays />
      <WordHighlightCaptions captions={captions} style={style} />
      <ProgressBar color={style.activeColor} />
    </AbsoluteFill>
  );
};
