import { useState } from 'react';
import { ChevronDown, ChevronRight, Play, Square, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
import { PanelContainer } from '../PanelContainer/PanelContainer';
import { usePanelCollapse } from '../usePanelCollapse';
import { useActionStore } from '../../app/store/action-store';
import type { Action } from '../../actions/action-types';
import styles from './ActionsPanel.module.css';

function stepLabel(step: Action['steps'][number]): string {
  switch (step.type) {
    case 'filter':
      return `Filter: ${step.filter}`;
    case 'adjustment':
      return `Adjustment: ${step.adjustment}`;
    case 'selection':
      return `Selection: ${step.operation}`;
    case 'layer':
      return `Layer: ${step.operation}`;
  }
}

interface ActionRowProps {
  action: Action;
  onPlay: (id: string) => void;
  onDelete: (id: string) => void;
}

function ActionRow({ action, onPlay, onDelete }: ActionRowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.actionRow} data-action-id={action.id}>
      <div className={styles.actionHeader}>
        <button
          type="button"
          className={styles.expandButton}
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${action.name}`}
        >
          <span className={styles.expandIcon} aria-hidden="true">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className={styles.actionName}>{action.name}</span>
          <span className={styles.stepCount}>{action.steps.length}</span>
        </button>
        <div className={styles.actionButtons}>
          <IconButton
            icon={<Play size={12} />}
            label={`Play ${action.name}`}
            onClick={() => onPlay(action.id)}
          />
          <IconButton
            icon={<Trash2 size={12} />}
            label={`Delete ${action.name}`}
            onClick={() => onDelete(action.id)}
          />
        </div>
      </div>
      {expanded && (
        <ol className={styles.stepList} aria-label={`Steps in ${action.name}`}>
          {action.steps.map((step, i) => (
            <li key={i} className={styles.stepItem}>
              {stepLabel(step)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

interface StopRecordingFormProps {
  onStop: (name: string) => void;
  onCancel: () => void;
}

function StopRecordingForm({ onStop, onCancel }: StopRecordingFormProps) {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStop(name);
  };

  return (
    <form className={styles.stopForm} onSubmit={handleSubmit}>
      <input
        type="text"
        className={styles.nameInput}
        placeholder="Action name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Action name"
        autoFocus
      />
      <div className={styles.stopFormButtons}>
        <button type="submit" className={styles.saveButton}>
          Save
        </button>
        <button type="button" className={styles.cancelButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ActionsPanel() {
  const [collapsed, setCollapsed] = usePanelCollapse('actions');
  const actions = useActionStore((s) => s.actions);
  const isRecording = useActionStore((s) => s.isRecording);
  const currentSteps = useActionStore((s) => s.currentRecordingSteps);
  const startRecording = useActionStore((s) => s.startRecording);
  const stopRecording = useActionStore((s) => s.stopRecording);
  const cancelRecording = useActionStore((s) => s.cancelRecording);
  const playAction = useActionStore((s) => s.playAction);
  const deleteAction = useActionStore((s) => s.deleteAction);

  const [isStopping, setIsStopping] = useState(false);

  const handleRecordClick = () => {
    if (isRecording) {
      setIsStopping(true);
    } else {
      startRecording();
    }
  };

  const handleStopSave = (name: string) => {
    stopRecording(name);
    setIsStopping(false);
  };

  const handleStopCancel = () => {
    cancelRecording();
    setIsStopping(false);
  };

  return (
    <PanelContainer title="Actions" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)}>
      <div className={styles.panel}>
        <div className={styles.toolbar}>
          <button
            type="button"
            className={`${styles.recordButton} ${isRecording ? styles.recordButtonActive : ''}`}
            onClick={handleRecordClick}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            aria-pressed={isRecording}
          >
            {isRecording ? <Square size={12} /> : <span className={styles.recordDot} aria-hidden="true" />}
            {isRecording ? 'Stop' : 'Record'}
          </button>
          {isRecording && (
            <span className={styles.recordingBadge} role="status" aria-live="polite">
              {currentSteps.length} step{currentSteps.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {isStopping && (
          <StopRecordingForm onStop={handleStopSave} onCancel={handleStopCancel} />
        )}

        {actions.length === 0 && !isRecording ? (
          <div className={styles.empty}>No actions saved</div>
        ) : (
          <div className={styles.actionList}>
            {actions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                onPlay={playAction}
                onDelete={deleteAction}
              />
            ))}
          </div>
        )}
      </div>
    </PanelContainer>
  );
}
