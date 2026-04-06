interface Props {
  size?: number;
  className?: string;
}

/** Uses currentColor so CSS can re-tint in different contexts. */
export function Logo({ size = 32, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g fill="currentColor">
        <rect x="5" y="20" width="3" height="8" rx="1.5" />
        <rect x="10" y="14" width="3" height="20" rx="1.5" />
        <rect x="15" y="18" width="3" height="12" rx="1.5" />
        <rect x="20" y="10" width="3" height="28" rx="1.5" />
        <rect x="26" y="14" width="3" height="20" rx="1.5" />
        <rect x="31" y="18" width="3" height="12" rx="1.5" />
        <rect x="36" y="10" width="3" height="28" rx="1.5" />
        <rect x="41" y="20" width="3" height="8" rx="1.5" />
      </g>
      <line
        x1="24"
        y1="6"
        x2="24"
        y2="42"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="2 3"
        strokeLinecap="round"
      />
    </svg>
  );
}
