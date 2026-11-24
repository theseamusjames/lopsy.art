import { useId, type ReactNode } from 'react';
import styles from './StepArt.module.css';

/** The three steps of getting started, each with a drawing. */
export type Step = 'connect' | 'upload' | 'edit';

/** A folder, 60 wide and 42 tall, its tab at the top left. */
function folder(x: number, y: number): string {
  return `M${x} ${y + 4}a4 4 0 0 1 4-4h16l7 7h29a4 4 0 0 1 4 4v27a4 4 0 0 1-4 4h-52a4 4 0 0 1-4-4z`;
}

/** A small closed padlock, centred on `cx`. */
function Padlock({ cx, y }: { cx: number; y: number }) {
  return (
    <g className={styles.faint}>
      <rect x={cx - 6} y={y} width={12} height={9} rx={2} />
      <path d={`M${cx - 3.5} ${y}v-3a3.5 3.5 0 0 1 7 0v3`} />
    </g>
  );
}

/** One folder Photonamous may use, between two it may not. */
function Connect() {
  return (
    <>
      <path className={styles.dashed} d={folder(22, 50)} />
      <Padlock cx={52} y={72} />
      <path className={styles.dashed} d={folder(158, 50)} />
      <Padlock cx={188} y={72} />
      <path className={styles.chosen} d={folder(90, 46)} />
      <path className={styles.accent} d="M110 72l8 8 13-15" />
    </>
  );
}

/** Photos going up into the visitor's own cloud, where the folder is. */
function Upload() {
  return (
    <>
      <rect className={styles.faint} x={28} y={48} width={62} height={46} rx={5} transform="rotate(-9 59 71)" />
      <rect className={styles.paper} x={40} y={54} width={62} height={46} rx={5} />
      <circle className={styles.line} cx={56} cy={68} r={5} />
      <path className={styles.line} d="M46 96l15-16 10 10 9-9 16 15" />
      <path className={styles.accent} d="M116 77h24M132 69l8 8-8 8" />
      <path
        className={styles.line}
        vectorEffect="non-scaling-stroke"
        transform="translate(150 39) scale(3.2)"
        d="M6 19c-2.2091 0-4-1.7909-4-4 0-1.8642 1.2753-3.4306 3.0011-3.8743A7 7 0 0 1 5 11c0-3.866 3.134-7 7-7 3.6099 0 6.5815 2.7325 6.9594 6.2419C20.7284 10.8481 22 12.5255 22 14.5c0 2.4853-2.0147 4.5-4.5 4.5z"
      />
      <path className={styles.thin} d="M176 75a2 2 0 0 1 2-2h6l3 3h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-20a2 2 0 0 1-2-2z" />
    </>
  );
}

/** A photo under the before-and-after divider, in the middle of the drawing: the edit, and nothing else. */
function Edit({ clip }: { clip: string }) {
  return (
    <>
      <clipPath id={clip}>
        <rect x={64} y={28} width={112} height={84} rx={6} />
      </clipPath>
      <rect className={styles.tint} x={120} y={28} width={56} height={84} clipPath={`url(#${clip})`} />
      <rect className={styles.line} x={64} y={28} width={112} height={84} rx={6} />
      <circle className={styles.line} cx={90} cy={52} r={7} />
      <path className={styles.line} d="M72 104l26-28 18 18 14-14 34 24" />
      <path className={styles.accent} d="M120 20v100" />
      <circle className={styles.knob} cx={120} cy={70} r={5} />
    </>
  );
}

interface StepArtProps {
  readonly step: Step;
}

/** The drawing for one step of getting started. Decoration: the step's words say what it shows. */
export function StepArt({ step }: StepArtProps) {
  const clip = useId();
  const drawings: Record<Step, ReactNode> = { connect: <Connect />, upload: <Upload />, edit: <Edit clip={clip} /> };
  return (
    <svg className={styles.art} viewBox="0 0 240 140" aria-hidden="true" focusable="false">
      {drawings[step]}
    </svg>
  );
}
