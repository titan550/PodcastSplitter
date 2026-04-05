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
    { key: "title", value: "Part 1" },
    { key: "encoder", value: "Podcast Splitter" },
  ],
};

describe("buildEncodeArgs", () => {
  describe("no prefix, no cover, source mode", () => {
    const args = buildEncodeArgs(base);

    it("has source input", () => {
      expect(has(args, "-i", "input.mp3")).toBe(true);
    });

    it("has atempo filter with aformat", () => {
      const af = args[args.indexOf("-af") + 1];
      expect(af).toContain("atempo=1.25");
      expect(af).toContain("aformat=sample_fmts=fltp");
    });

    it("preserves source rate and channels", () => {
      expect(hasSequence(args, "-ar", "44100")).toBe(true);
      expect(hasSequence(args, "-ac", "2")).toBe(true);
    });

    it("has no cover mapping", () => {
      expect(args.join(" ")).not.toContain("attached_pic");
    });

    it("has metadata", () => {
      expect(hasMetadata(args, "title", "Part 1")).toBe(true);
      expect(hasMetadata(args, "encoder", "Podcast Splitter")).toBe(true);
    });

    it("output is last", () => {
      expect(args[args.length - 1]).toBe("out.mp3");
    });
  });

  describe("no prefix, with cover, source mode", () => {
    const args = buildEncodeArgs({ ...base, coverFile: "cover.jpg" });

    it("maps cover as attached pic", () => {
      expect(hasSequence(args, "-map", "1:v")).toBe(true);
      expect(has(args, "-c:v", "copy")).toBe(true);
      expect(hasSequence(args, "-disposition:v:0", "attached_pic")).toBe(true);
    });

    it("includes id3v2 version", () => {
      expect(hasSequence(args, "-id3v2_version", "3")).toBe(true);
    });
  });

  describe("with prefix, no cover, source mode 44.1k stereo", () => {
    const args = buildEncodeArgs({
      ...base,
      prefixFile: "prefix.wav",
    });

    it("has prefix as input 0 and source as input 1", () => {
      const firstI = args.indexOf("-i");
      expect(args[firstI + 1]).toBe("prefix.wav");
    });

    it("filter complex resamples prefix and source to target", () => {
      const fc = args[args.indexOf("-filter_complex") + 1]!;
      // Prefix upsampled to 44100 stereo
      expect(fc).toContain(
        "[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,apad=pad_dur=0.5[pfx]",
      );
      // Source also normalized
      expect(fc).toContain(
        "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[seg]",
      );
      expect(fc).toContain("[pfx][seg]concat=n=2:v=0:a=1[out]");
    });

    it("maps [out]", () => {
      expect(hasSequence(args, "-map", "[out]")).toBe(true);
    });
  });

  describe("with prefix, with cover, voice mode", () => {
    const args = buildEncodeArgs({
      ...base,
      prefixFile: "prefix.wav",
      coverFile: "cover.jpg",
      audioProfile: "voice",
    });

    it("filter complex uses 22050 mono", () => {
      const fc = args[args.indexOf("-filter_complex") + 1]!;
      expect(fc).toContain("aresample=22050");
      expect(fc).toContain("channel_layouts=mono");
    });

    it("cover is input 2", () => {
      expect(hasSequence(args, "-map", "2:v")).toBe(true);
    });
  });

  describe("skip silence", () => {
    it("includes silenceremove in filter", () => {
      const args = buildEncodeArgs({
        ...base,
        skipSilence: { minDurationSec: 3, thresholdDb: -30 },
      });
      const af = args[args.indexOf("-af") + 1]!;
      expect(af).toContain("silenceremove=stop_periods=-1");
      expect(af).toContain("stop_duration=3.00");
      expect(af).toContain("stop_threshold=-30dB");
    });
  });

  describe("source rate clamping", () => {
    it("96k source → 48k in args", () => {
      const args = buildEncodeArgs({
        ...base,
        sourceSampleRate: 96000,
      });
      expect(hasSequence(args, "-ar", "48000")).toBe(true);
    });
  });

  describe("5.1 channel downmix", () => {
    it("6 channels → stereo", () => {
      const args = buildEncodeArgs({
        ...base,
        sourceChannels: 6,
      });
      expect(hasSequence(args, "-ac", "2")).toBe(true);
    });
  });

  describe("arg ordering", () => {
    it("inputs come before filter, filter before maps, maps before codec, metadata before output", () => {
      const args = buildEncodeArgs({
        ...base,
        prefixFile: "prefix.wav",
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
