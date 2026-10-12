import type { Caption } from "@remotion/captions";

export type { Caption };

export type MediaType = "video" | "audio";

export type CaptionStyle = {
  /** Max words shown at once (chunks are balanced to 2–3 words by default). */
  maxWordsPerChunk: number;
  /** Colour of the currently spoken word. */
  activeColor: string;
  /** Colour of the other words in the chunk. */
  baseColor: string;
  fontSize: number;
  /** Vertical centre of the caption block, as a fraction of frame height (0.5 = middle). */
  verticalPosition: number;
  uppercase: boolean;
};

export type ShortProps = {
  /** Path inside /public (e.g. "inputs/clip.mp4"), a URL, or null for a placeholder background. */
  mediaSrc: string | null;
  mediaType: MediaType;
  /** Word-level captions (one entry per word), as produced by scripts/generate-short.ts. */
  captions: Caption[];
  /** Media duration. When null it is derived from the media file or the last caption. */
  durationInSeconds: number | null;
  /** Strength of the camera punch-ins (max extra scale, e.g. 0.1 = up to 1.1x). */
  punchInStrength: number;
  captionStyle: CaptionStyle;
};

export const defaultCaptionStyle: CaptionStyle = {
  maxWordsPerChunk: 3,
  activeColor: "#FFE600",
  baseColor: "#FFFFFF",
  fontSize: 104,
  verticalPosition: 0.6,
  uppercase: true,
};
