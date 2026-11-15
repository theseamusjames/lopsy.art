import type { ReactNode } from 'react';

interface SnapAnchorIconProps {
  size?: number;
}

/** A box with one edge or centre line drawn through it: the part of the content that snaps. */
function AnchorIcon({ size = 24, children }: SnapAnchorIconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const BOX = <rect x="7" y="7" width="10" height="10" rx="1" strokeDasharray="0 4" />;

export function SnapAnchorLeftIcon({ size }: SnapAnchorIconProps) {
  return <AnchorIcon size={size}>{BOX}<path d="M7 3v18" /></AnchorIcon>;
}

export function SnapAnchorCenterIcon({ size }: SnapAnchorIconProps) {
  return <AnchorIcon size={size}>{BOX}<path d="M12 3v18" /></AnchorIcon>;
}

export function SnapAnchorRightIcon({ size }: SnapAnchorIconProps) {
  return <AnchorIcon size={size}>{BOX}<path d="M17 3v18" /></AnchorIcon>;
}

export function SnapAnchorTopIcon({ size }: SnapAnchorIconProps) {
  return <AnchorIcon size={size}>{BOX}<path d="M3 7h18" /></AnchorIcon>;
}

export function SnapAnchorMiddleIcon({ size }: SnapAnchorIconProps) {
  return <AnchorIcon size={size}>{BOX}<path d="M3 12h18" /></AnchorIcon>;
}

export function SnapAnchorBottomIcon({ size }: SnapAnchorIconProps) {
  return <AnchorIcon size={size}>{BOX}<path d="M3 17h18" /></AnchorIcon>;
}
