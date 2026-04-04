import { useCallback, useRef, useState, type DragEvent } from "react";

interface Props {
  isMobile: boolean;
  onFileSelected: (file: File) => void;
}

export function FilePicker({ isMobile, onFileSelected }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith(".mp3")) {
        alert("Please select an MP3 file.");
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
        accept=".mp3,audio/mpeg"
        onChange={handleInput}
        hidden
      />
      <p className="file-picker__label">
        {dragging
          ? "Drop MP3 here"
          : "Drop an MP3 file here, or click to browse"}
      </p>
    </div>
  );
}
