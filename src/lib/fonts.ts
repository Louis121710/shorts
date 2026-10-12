import { loadFont } from "@remotion/google-fonts/Montserrat";

// Blocks rendering (delayRender) until the font is ready, so no frame renders with a fallback font.
export const { fontFamily: captionFontFamily } = loadFont("normal", {
  weights: ["800", "900"],
  subsets: ["latin"],
});
