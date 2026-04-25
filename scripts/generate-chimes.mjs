#!/usr/bin/env node
// Generates public/chimes/begin.wav and end.wav as short two-note sine chimes.
// Wired into `postinstall` alongside the vendor-asset copy step, so a fresh
// clone gets working chimes without committing binaries. Run manually via:
//   node scripts/generate-chimes.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 44100;
const NOTE_SEC = 0.2;
const TOTAL_SEC = NOTE_SEC * 2;
const FADE_IN_SEC = 0.03;
const FADE_OUT_SEC = 0.08;
const VOLUME_DB = -6;

function synth(note1Hz, note2Hz) {
  const total = Math.round(TOTAL_SEC * SAMPLE_RATE);
  const noteSamples = Math.round(NOTE_SEC * SAMPLE_RATE);
  const fadeInSamples = Math.round(FADE_IN_SEC * SAMPLE_RATE);
  const fadeOutSamples = Math.round(FADE_OUT_SEC * SAMPLE_RATE);
  const fadeOutStart = total - fadeOutSamples;
  const amp = Math.pow(10, VOLUME_DB / 20);

  const samples = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const freq = i < noteSamples ? note1Hz : note2Hz;
    const tNote = (i < noteSamples ? i : i - noteSamples) / SAMPLE_RATE;
    let s = Math.sin(2 * Math.PI * freq * tNote);

    // Fade in at start of clip
    if (i < fadeInSamples) s *= i / fadeInSamples;
    // Fade out near end of clip
    if (i >= fadeOutStart) s *= 1 - (i - fadeOutStart) / fadeOutSamples;
    // Crossfade between notes to avoid click at the boundary
    const boundaryFade = Math.round(0.005 * SAMPLE_RATE);
    if (i >= noteSamples - boundaryFade && i < noteSamples + boundaryFade) {
      const edge = Math.abs(i - noteSamples) / boundaryFade;
      s *= edge;
    }

    s *= amp;
    samples[i] = Math.max(-32767, Math.min(32767, Math.round(s * 32767)));
  }
  return samples;
}

function wav(samples) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  // RIFF header
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  // fmt chunk
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // subchunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  // data chunk
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buf;
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "public", "chimes");
mkdirSync(outDir, { recursive: true });

const begin = wav(synth(880, 1320)); // ascending
const end = wav(synth(1320, 880)); // descending

writeFileSync(resolve(outDir, "begin.wav"), begin);
writeFileSync(resolve(outDir, "end.wav"), end);
console.log(`Wrote ${begin.length} bytes to begin.wav and ${end.length} bytes to end.wav.`);
