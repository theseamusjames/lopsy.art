import { useSyncExternalStore } from 'react';
import { Sun } from 'lucide-react';
import { StatusBar, StatusDivider, StatusItem, StatusSpacer } from '@lopsy/ui/StatusBar';
import { useOrderedIds } from '../../app/hooks';
import { useUi, type EditSizes } from '../../app/store';
import {
  HDR_VIEW_SWITCH_LABEL,
  currentStatus,
  displayLabel,
  hdrLabel,
  onStatusChange,
  rendererLabel,
  setHdrView,
  type EngineStatus,
} from '../../engine/engine-status';
import { IconButton } from '../IconButton/IconButton';
import { countWords, isReduced, sizeWords } from './status-text';
import styles from './AppStatusBar.module.css';

export interface StatusBarContentProps {
  readonly status: EngineStatus;
  /** The Edit view's sizes; null in the library, or while the Edit view has no photo yet. */
  readonly editSizes: EditSizes | null;
  readonly isEditing: boolean;
  readonly shownCount: number;
  readonly selectedCount: number;
  /** The HDR switch was pressed: show the HDR rendering (true) or the ordinary screen's (false). */
  readonly onHdrViewChange?: (isHdrView: boolean) => void;
}

/**
 * The bar's contents, from plain values (Storybook, tests). At the left,
 * the Edit view's photo size and working size, or the library's counts;
 * at the right, the renderer and the display.
 */
export function StatusBarContent({ status, editSizes, isEditing, shownCount, selectedCount, onHdrViewChange }: StatusBarContentProps) {
  const renderer = rendererLabel(status);
  const hdr = hdrLabel(status);
  return (
    <div className={styles.frame}>
      <StatusBar label="Status bar" isLive={false} data-testid="status-bar">
        {isEditing ? (
          editSizes && (
            <>
              <StatusItem name="Photo size" data-testid="status-photo-size">
                {sizeWords(editSizes.photo)}
              </StatusItem>
              <span className={styles.wide}>
                <StatusDivider />
                <StatusItem name="Editing at" data-testid="status-working-size">
                  {isReduced(editSizes) ? sizeWords(editSizes.working) : 'full size'}
                </StatusItem>
              </span>
            </>
          )
        ) : (
          <>
            <StatusItem data-testid="status-shown">{countWords(shownCount, 'photo')}</StatusItem>
            {selectedCount > 0 && (
              <>
                <StatusDivider />
                <StatusItem data-testid="status-selected">{`${selectedCount.toLocaleString('en-US')} selected`}</StatusItem>
              </>
            )}
          </>
        )}
        <StatusSpacer />
        {renderer && (
          <>
            <StatusItem name="Renderer" data-testid="status-renderer">
              {renderer}
            </StatusItem>
            <StatusDivider />
          </>
        )}
        <StatusItem name="Display" data-testid="status-display">
          {displayLabel(status)}
        </StatusItem>
        {hdr && (
          <>
            <StatusDivider />
            <StatusItem name="Dynamic range" data-testid="status-hdr">
              {hdr}
            </StatusItem>
            {/* Most people who receive the photo see the ordinary rendering, so it can be checked here. */}
            <IconButton
              size="sm"
              label={HDR_VIEW_SWITCH_LABEL}
              icon={<Sun size={14} aria-hidden />}
              pressed={status.isHdrView}
              data-testid="status-hdr-view"
              onClick={() => onHdrViewChange?.(!status.isHdrView)}
            />
          </>
        )}
      </StatusBar>
    </div>
  );
}

/** The status bar along the bottom of the window, in the library and the Edit view alike. */
export function AppStatusBar() {
  const status = useSyncExternalStore(onStatusChange, currentStatus);
  const isEditing = useUi((s) => s.editing !== null);
  const editSizes = useUi((s) => s.editSizes);
  const selectedCount = useUi((s) => s.selection.ids.size);
  const shownCount = useOrderedIds().length;
  return (
    <StatusBarContent
      status={status}
      editSizes={editSizes}
      isEditing={isEditing}
      shownCount={shownCount}
      selectedCount={selectedCount}
      onHdrViewChange={setHdrView}
    />
  );
}
