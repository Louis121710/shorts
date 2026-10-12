import React from "react";
import { Composition, staticFile } from "remotion";
import { CapCutStyleSubtitles, WhisperTranscript } from "./CapCutStyleSubtitles";
import transcriptJson from "./transcript.json";

const transcript = transcriptJson as WhisperTranscript;
const FPS = 60;

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Short"
    component={CapCutStyleSubtitles}
    fps={FPS}
    width={1080}
    height={1920}
    durationInFrames={FPS * 30}
    defaultProps={{ transcript, videoSrc: staticFile("input.mp4") }}
    calculateMetadata={({ props }) => {
      const segs = props.transcript.segments;
      const lastEnd = segs[segs.length - 1]?.end ?? 30;
      return { durationInFrames: Math.ceil((lastEnd + 0.5) * FPS) };
    }}
  />
);