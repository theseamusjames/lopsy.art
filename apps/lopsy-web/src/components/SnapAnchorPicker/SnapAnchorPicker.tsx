import type { ComponentType } from 'react';
import type { HorizontalSnapAnchor, SnapAnchor, VerticalSnapAnchor } from '../../tools/move/snap-anchor';
import {
  SnapAnchorBottomIcon,
  SnapAnchorCenterIcon,
  SnapAnchorLeftIcon,
  SnapAnchorMiddleIcon,
  SnapAnchorRightIcon,
  SnapAnchorTopIcon,
} from '../../icons/SnapAnchorIcons';
import styles from './SnapAnchorPicker.module.css';

interface SnapAnchorPickerProps {
  anchor: SnapAnchor;
  onHorizontalChange: (horizontal: HorizontalSnapAnchor) => void;
  onVerticalChange: (vertical: VerticalSnapAnchor) => void;
  disabled?: boolean;
}

interface AnchorOption<T extends string> {
  value: T;
  label: string;
  Icon: ComponentType<{ size?: number }>;
}

const HORIZONTAL: readonly AnchorOption<HorizontalSnapAnchor>[] = [
  { value: 'left', label: 'Snap left edge to grid', Icon: SnapAnchorLeftIcon },
  { value: 'center', label: 'Snap horizontal center to grid', Icon: SnapAnchorCenterIcon },
  { value: 'right', label: 'Snap right edge to grid', Icon: SnapAnchorRightIcon },
];

const VERTICAL: readonly AnchorOption<VerticalSnapAnchor>[] = [
  { value: 'top', label: 'Snap top edge to grid', Icon: SnapAnchorTopIcon },
  { value: 'middle', label: 'Snap vertical center to grid', Icon: SnapAnchorMiddleIcon },
  { value: 'bottom', label: 'Snap bottom edge to grid', Icon: SnapAnchorBottomIcon },
];

function AnchorGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly AnchorOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled: boolean;
}) {
  return (
    <div className={styles.group} role="group" aria-label={label}>
      {options.map(({ value: option, label: optionLabel, Icon }) => (
        <button
          key={option}
          type="button"
          className={`${styles.button} ${value === option ? styles.active : ''}`}
          aria-label={optionLabel}
          title={optionLabel}
          aria-pressed={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}

/**
 * Two three-way toggles choosing which edge or centre of the moving content
 * lands on the grid: one across, one down.
 */
export function SnapAnchorPicker({
  anchor,
  onHorizontalChange,
  onVerticalChange,
  disabled = false,
}: SnapAnchorPickerProps) {
  return (
    <div className={styles.picker}>
      <AnchorGroup
        label="Horizontal snap point"
        options={HORIZONTAL}
        value={anchor.horizontal}
        onChange={onHorizontalChange}
        disabled={disabled}
      />
      <AnchorGroup
        label="Vertical snap point"
        options={VERTICAL}
        value={anchor.vertical}
        onChange={onVerticalChange}
        disabled={disabled}
      />
    </div>
  );
}
