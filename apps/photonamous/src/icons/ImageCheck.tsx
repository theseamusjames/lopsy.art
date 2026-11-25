interface ImageCheckProps {
  readonly size?: number;
}

/**
 * A picture with a tick at its corner: this photo has been edited. Drawn
 * the way Lucide draws its icons, on Lucide's own picture (image-plus,
 * with the plus made a tick): the version of Lucide here has no
 * image-check.
 */
export function ImageCheck({ size = 16 }: ImageCheckProps) {
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
      <path d="m16 5 2 2 4-4" />
      <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      <circle cx="9" cy="9" r="2" />
    </svg>
  );
}
