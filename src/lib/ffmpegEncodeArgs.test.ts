import { describe, it, expect } from "vitest";
import {
  clampToMp3Rate,
  resolveTargetFormat,
  buildEncodeArgs,
  type EncodeArgsInput,
} from "./ffmpegEncodeArgs";

describe("clampToMp3Rate", () => {
  it("passes through supported rates", () => {
    expect(clampToMp3Rate(44100)).toBe(44100);
    expect(clampToMp3Rate(22050)).toBe(22050);
    expect(clampToMp3Rate(48000)).toBe(48000);
    expect(clampToMp3Rate(8000)).toBe(8000);
    expect(clampToMp3Rate(11025)).toBe(11025);
  });

  it("floors to nearest supported rate", () => {
    expect(clampToMp3Rate(40000)).toBe(32000);
    expect(clampToMp3Rate(30000)).toBe(24000);
  });

  it("caps high rates at 48000", () => {
    expect(clampToMp3Rate(96000)).toBe(48000);
    expect(clampToMp3Rate(192000)).toBe(48000);
  });

  it("floors sub-8k rates to 8000", () => {
    expect(clampToMp3Rate(7000)).toBe(8000);
    expect(clampToMp3Rate(100)).toBe(8000);
  });
});

describe("resolveTargetFormat", () => {
  it("source profile preserves stereo 44.1k", () => {
    expect(resolveTargetFormat("source", 44100, 2)).toEqual({
      rate: 44100,
      layout: "stereo",
    });
  });

  it("source profile preserves mono 16k", () => {
    expect(resolveTargetFormat("source", 16000, 1)).toEqual({
      rate: 16000,
      layout: "mono",
    });
  });

  it("source profile clamps 96k to 48k", () => {
    expect(resolveTargetFormat("source", 96000, 2)).toEqual({
      rate: 48000,
      layout: "stereo",
    });
  });

  it("source profile clamps 5.1 to stereo", () => {
    expect(resolveTargetFormat("source", 44100, 6)).toEqual({
      rate: 44100,
      layout: "stereo",
    });
  });

  it("voice profile always returns 22050 mono", () => {
    expect(resolveTargetFormat("voice", 44100, 2)).toEqual({
      rate: 22050,
      layout: "mono",
    });
  });

  it("defaults to 44100 stereo when source info is missing", () => {
    expect(resolveTargetFormat("source", undefined, undefined)).toEqual({
      rate: 44100,
      layout: "stereo",
    });
  });
});

// Helpers for scanning the built arg arrays
function has(args: string[], ...flags: string[]): boolean {
  return flags.every((f) => args.includes(f));
}
function hasSequence(args: string[], ...seq: string[]): boolean {
  for (let i = 0; i <= args.length - seq.length; i++) {
    if (seq.every((s, j) => args[i + j] === s)) return true;
  }
  return false;
}
function hasMetadata(args: string[], key: string, value: string): boolean {
  return args.includes(`${key}=${value}`);
}

const base: EncodeArgsInput = {
  inputFile: "input.mp3",
  prefixFile: undefined,
  suffixFile: undefined,
  beginChimeFile: "begin.wav",
  endChimeFile: "end.wav",
  coverFile: undefined,
  startSec: 0,
  endSec: 300,
  speed: 1.25,
  bitrate: "128k",
  outputFile: "out.mp3",
  skipSilence: undefined,
  sourceSampleRate: 44100,
  sourceChannels: 2,
  audioProfile: "source",
  tags: [
    { key: "title", value: "Part 1 of 9" },
    { key: "encoder", value: "Podcast Splitter" },
  ],
};

describe("buildEncodeArgs", () => {
  describe("no announcements (2-chime bookend)", () => {
    const args = buildEncodeArgs(base);

    it("has begin chime as input 0, source as input 1, end chime as input 2", () => {
      expect(args[0]).toBe("-i");
      expect(args[1]).toBe("begin.wav");
      expect(has(args, "-i", "input.mp3")).toBe(true);
      expect(has(args, "-i", "end.wav")).toBe(true);
    });

    it("filter complex uses concat n=3 bookend pattern", () => {
      const fc = args[args.indexOf("-filter_complex") + 1]!;
      expect(fc).toContain("[0:a]aresample=");
      expect(fc).toContain("atempo=1.25");
      expect(fc).toContain("[b][seg][e]concat=n=3:v=0:a=1[out]");
    });

    it("maps [out]", () => {
      expect(hasSequence(args, "-map", "[out]")).toBe(true);
    });

    it("has metadata", () => {
      expect(hasMetadata(args, "title", "Part 1 of 9")).toBe(true);
      expect(hasMetadata(args, "encoder", "Podcast Splitter")).toBe(true);
    });

    it("output is last", () => {
      expect(args[args.length - 1]).toBe("out.mp3");
    });
  });

  describe("with announcements (4-chime pattern)", () => {
    const args = buildEncodeArgs({
      ...base,
      prefixFile: "prefix.wav",
      suffixFile: "suffix.wav",
    });

    it("filter complex uses asplit + concat n=7", () => {
      const fc = args[args.indexOf("-filter_complex") + 1]!;
      expect(fc).toContain("asplit=2[b1][b2]");
      expect(fc).toContain("asplit=2[e1][e2]");
      expect(fc).toContain("[b1][pfx][b2][seg][e1][sfx][e2]concat=n=7:v=0:a=1[out]");
    });

    it("prefix and suffix get apad=0.3", () => {
      const fc = args[args.indexOf("-filter_complex") + 1]!;
      expect(fc).toContain(",apad=pad_dur=0.3[pfx]");
      expect(fc).toContain(",apad=pad_dur=0.3[sfx]");
    });
  });

  describe("with cover art", () => {
    it("maps cover correctly with bookend-only inputs", () => {
      const args = buildEncodeArgs({ ...base, coverFile: "cover.jpg" });
      // Inputs: begin (0), source (1), end (2), cover (3)
      expect(hasSequence(args, "-map", "3:v")).toBe(true);
      expect(has(args, "-c:v", "copy")).toBe(true);
      expect(hasSequence(args, "-disposition:v:0", "attached_pic")).toBe(true);
      expect(hasSequence(args, "-id3v2_version", "3")).toBe(true);
    });

    it("cover index shifts when announcements add prefix+suffix", () => {
      const args = buildEncodeArgs({
        ...base,
        prefixFile: "prefix.wav",
        suffixFile: "suffix.wav",
        coverFile: "cover.jpg",
      });
      // Inputs: begin (0), prefix (1), source (2), suffix (3), end (4), cover (5)
      expect(hasSequence(args, "-map", "5:v")).toBe(true);
    });
  });

  describe("voice profile", () => {
    const args = buildEncodeArgs({
      ...base,
      audioProfile: "voice",
    });

    it("filter complex uses 22050 mono throughout", () => {
      const fc = args[args.indexOf("-filter_complex") + 1]!;
      expect(fc).toContain("aresample=22050");
      expect(fc).toContain("channel_layouts=mono");
    });
  });

  describe("skip silence", () => {
    it("includes silenceremove BEFORE atempo in the source leg", () => {
      const args = buildEncodeArgs({
        ...base,
        skipSilence: { minDurationSec: 3, thresholdDb: -40 },
      });
      const fc = args[args.indexOf("-filter_complex") + 1]!;
      expect(fc).toContain(
        "silenceremove=stop_periods=-1:stop_duration=3.00:stop_threshold=-40dB:stop_silence=0.5",
      );
      // silenceremove must appear before atempo so stop_duration is measured in source-time.
      const sil = fc.indexOf("silenceremove");
      const tempo = fc.indexOf("atempo=1.25");
      expect(sil).toBeLessThan(tempo);
    });
  });

  describe("source rate clamping", () => {
    it("96k source → 48k in filter graph", () => {
      const args = buildEncodeArgs({
        ...base,
        sourceSampleRate: 96000,
      });
      const fc = args[args.indexOf("-filter_complex") + 1]!;
      expect(fc).toContain("aresample=48000");
    });
  });

  describe("5.1 channel downmix", () => {
    it("6 channels → stereo layout", () => {
      const args = buildEncodeArgs({
        ...base,
        sourceChannels: 6,
      });
      const fc = args[args.indexOf("-filter_complex") + 1]!;
      expect(fc).toContain("channel_layouts=stereo");
    });
  });

  describe("arg ordering", () => {
    it("inputs come before filter, filter before maps, maps before codec, metadata before output", () => {
      const args = buildEncodeArgs({
        ...base,
        prefixFile: "prefix.wav",
        suffixFile: "suffix.wav",
        coverFile: "cover.jpg",
      });
      const iInput = args.indexOf("-i");
      const iFilter = args.indexOf("-filter_complex");
      const iMap = args.indexOf("-map");
      const iCodec = args.indexOf("-c:a");
      const iMeta = args.indexOf("-metadata");
      const iOut = args.indexOf("out.mp3");
      expect(iInput).toBeLessThan(iFilter);
      expect(iFilter).toBeLessThan(iMap);
      expect(iMap).toBeLessThan(iCodec);
      expect(iCodec).toBeLessThan(iMeta);
      expect(iMeta).toBeLessThan(iOut);
    });
  });
});
