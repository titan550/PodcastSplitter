import { useRef } from "react";

// TODO: drop in real repo URL once the project is public
const GITHUB_URL = "#";
const COFFEE_URL = "https://buymeacoffee.com/tinkerlake";

export function Footer() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const openAbout = () => dialogRef.current?.showModal();
  const closeAbout = () => dialogRef.current?.close();

  return (
    <>
      <footer className="app__footer">
        <button
          type="button"
          className="app__footer-link"
          onClick={openAbout}
          aria-label="About and disclaimer"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </button>
        <a
          className="app__footer-link"
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source on GitHub"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.66-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.12-.31-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23.96-.27 1.98-.4 3-.41 1.02.01 2.05.14 3 .41 2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.86.12 3.17.77.84 1.24 1.91 1.24 3.22 0 4.61-2.82 5.62-5.5 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57C20.56 22.3 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z" />
          </svg>
        </a>
        <a
          className="app__footer-link"
          href={COFFEE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Buy me a coffee"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
            <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8z" />
            <line x1="6" y1="2" x2="6" y2="5" />
            <line x1="10" y1="2" x2="10" y2="5" />
            <line x1="14" y1="2" x2="14" y2="5" />
          </svg>
        </a>
      </footer>

      <dialog
        ref={dialogRef}
        className="about-dialog"
        onClick={(e) => {
          // close when backdrop (the dialog element itself) is clicked
          if (e.target === dialogRef.current) closeAbout();
        }}
      >
        <div className="about-dialog__body">
          <h2>About</h2>
          <p>
            Podcast Splitter is provided &quot;as is&quot;, without warranty of
            any kind. All audio processing happens entirely in your browser
            &mdash; no files are uploaded, stored, or transmitted.
          </p>
          <p>
            You are responsible for ensuring you have the right to process any
            content you load into this tool. For personal use only. Not
            affiliated with any podcast, podcast host, or platform.
          </p>
          <p className="about-dialog__donate-note">
            Contributions via Buy Me a Coffee are voluntary gifts, not payment
            for a service.
          </p>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={closeAbout}
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
