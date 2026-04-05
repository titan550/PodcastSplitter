import { useCallback, useRef, useState, type DragEvent } from "react";
import {
  ACCEPT_ATTR,
  SUPPORTED_AUDIO_EXTS,
  isSupportedAudioFile,
} from "../lib/supportedFormats";

interface Props {
  isMobile: boolean;
  onFileSelected: (file: File) => void;
}

export function FilePicker({ isMobile, onFileSelected }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!isSupportedAudioFile(file.name)) {
        alert(
          `Unsupported format. Please select one of: ${SUPPORTED_AUDIO_EXTS.join(", ")}`,
        );
        return;
      }
      if (isMobile && file.size > 200 * 1024 * 1024) {
        const proceed = confirm(
          `This file is ${Math.round(file.size / 1024 / 1024)} MB. ` +
            `Large files may cause issues on mobile devices. Continue?`,
        );
        if (!proceed) return;
      }
      onFileSelected(file);
    },
    [isMobile, onFileSelected],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div
      className={`file-picker ${dragging ? "file-picker--dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        onChange={handleInput}
        hidden
      />
      <svg
        className="file-picker__icon"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="56"
        height="56"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <p className="file-picker__label">
        {dragging
          ? "Drop audio file here"
          : "Drop an audio file here, or click to browse"}
      </p>
      <p className="file-picker__hint">
        MP3, M4A, M4B, AAC, WAV, OGG, Opus, FLAC, or WebM. Output is always MP3.
      </p>
    </div>
  );
}
