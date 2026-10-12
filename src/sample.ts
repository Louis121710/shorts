import type { Caption } from "./types";

// Demo transcript for the Studio preview when no real input has been generated yet.
const SCRIPT: [string, number][] = [
  ["Most", 0.3], ["people", 0.32], ["edit", 0.3], ["shorts", 0.42], ["the", 0.15], ["hard", 0.3], ["way.", 0.6],
  ["This", 0.25], ["tool", 0.35], ["does", 0.25], ["it", 0.15], ["for", 0.18], ["you,", 0.5],
  ["captions,", 0.55], ["zooms,", 0.5], ["and", 0.2], ["motion", 0.35], ["graphics.", 0.7],
  ["One", 0.3], ["command.", 0.6], ["Done.", 0.8],
];

export const sampleCaptions: Caption[] = (() => {
  let t = 400;
  return SCRIPT.map(([word, dur], i) => {
    const startMs = t;
    const endMs = t + dur * 1000;
    t = endMs + (/[.]$/.test(word) ? 450 : 60);
    return { text: (i === 0 ? "" : " ") + word, startMs, endMs, timestampMs: startMs, confidence: 1 };
  });
})();
