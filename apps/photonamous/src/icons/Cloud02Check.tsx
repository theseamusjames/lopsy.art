interface Cloud02CheckProps {
  readonly size?: number;
}

/**
 * The app's cloud (Cloud02) with a tick in it: everything is saved. The
 * Untitled UI icons have no such cloud, so the tick is Lucide's, set in
 * the middle.
 */
export function Cloud02Check({ size = 16 }: Cloud02CheckProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 19c-2.2091 0-4-1.7909-4-4 0-1.8642 1.2753-3.4306 3.0011-3.8743A7 7 0 0 1 5 11c0-3.866 3.134-7 7-7 3.6099 0 6.5815 2.7325 6.9594 6.2419C20.7284 10.8481 22 12.5255 22 14.5c0 2.4853-2.0147 4.5-4.5 4.5z" />
      <path d="m9 12.5 2 2 4-4" />
    </svg>
  );
}
