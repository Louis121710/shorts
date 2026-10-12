import React from "react";
import { Composition, type CalculateMetadataFunction, Folder } from "remotion";
import { getAudioDurationInSeconds, getVideoMetadata } from "@remotion/media-utils";
import { Short, resolveMediaSrc } from "./Short";
import { sampleCaptions } from "./sample";
import { defaultCaptionStyle, type ShortProps } from "./types";

export const FPS = 60;
export const WIDTH = 1080;
export const HEIGHT = 1920;

const calculateMetadata: CalculateMetadataFunction<ShortProps> = async ({ props }) => {
  let seconds = props.durationInSeconds;

  if (seconds == null && props.mediaSrc) {
    const src = resolveMediaSrc(props.mediaSrc);
    seconds =
      props.mediaType === "video"
        ? (await getVideoMetadata(src)).durationInSeconds
        : await getAudioDurationInSeconds(src);
  }
  if (seconds == null) {
    const lastEnd = props.captions[props.captions.length - 1]?.endMs ?? 5000;
    seconds = lastEnd / 1000 + 0.75;
  }

  return { durationInFrames: Math.max(1, Math.ceil(seconds * FPS)) };
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Short"
      component={Short}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={FPS * 10}
      calculateMetadata={calculateMetadata}
      defaultProps={
        {
          mediaSrc: null,
          mediaType: "video",
          captions: sampleCaptions,
          durationInSeconds: null,
          punchInStrength: 0.1,
          captionStyle: defaultCaptionStyle,
        } satisfies ShortProps
      }
    />
    <Folder name="Shosho" />
  </>
);
