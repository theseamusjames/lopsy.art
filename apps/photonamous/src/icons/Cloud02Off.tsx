interface Cloud02OffProps {
  readonly size?: number;
}

/**
 * The app's cloud struck through: offline. It is "cloud-off" of the
 * Untitled UI icons (MIT), the same family as Cloud02.
 */
export function Cloud02Off({ size = 16 }: Cloud02OffProps) {
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
      <path d="M21.7003 16.1181A4.49 4.49 0 0 0 22 14.5c0-2.3436-1.7915-4.2687-4.0797-4.4806C17.4522 7.1721 14.9798 5 12 5a6.02 6.02 0 0 0-1.3005.1413m-3.412 2.1445a5.97 5.97 0 0 0-1.2078 2.7336C3.7915 10.2313 2 12.1564 2 14.5 2 16.9853 4.0147 19 6.5 19h11c.4561 0 .8963-.0678 1.3112-.194M3 3l18 18" />
    </svg>
  );
}
