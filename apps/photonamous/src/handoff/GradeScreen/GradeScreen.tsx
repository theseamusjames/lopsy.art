import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Asset, Json } from '@lopsy/photos-core/library/types';
import type { GradeSession } from '@lopsy/handoff/grade';
import type { GradeLayer, GradeRecipe } from '@lopsy/handoff/messages';
import { EditView } from '../../edit/EditView/EditView';
import { applyChanges } from '../../edit/edit-controls';
import { harnessAsset, harnessVersion } from '../../edit/EditHarness/harness-asset';
import { pushStep, redoStep, startHistory, undoStep, type RecipeHistory } from '../../edit/EditHarness/recipe-history';
import { LOPSY_LAYER_MIME } from '../../engine/develop-engine';
import styles from './GradeScreen.module.css';

interface GradeScreenProps {
  /** From `receiveGrade`: the layer Lopsy sends, and the way to answer. */
  session: GradeSession;
  /** Closes the tab once the answer is sent; Lopsy opened it, so it may. */
  onFinished: () => void;
}

type Phase =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'grading'; readonly layer: GradeLayer; readonly asset: Asset }
  | { readonly kind: 'sending' }
  | { readonly kind: 'finished'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

function recipeJson(recipe: Recipe): GradeRecipe {
  return JSON.parse(JSON.stringify(recipe)) as GradeRecipe;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Grade in Photonamous (spec 6.12): the Edit view on one layer Lopsy sent,
 * with no library. Done sends the graded layer and its recipe back; Cancel
 * sends nothing.
 */
export function GradeScreen({ session, onFinished }: GradeScreenProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  const [history, setHistory] = useState<RecipeHistory | null>(null);

  useEffect(() => {
    let isLive = true;
    session.layer.then(
      (layer) => {
        if (!isLive) return;
        const asset = harnessAsset(`grade-${session.id}`, `${layer.name}.png`, layer.pixels.byteLength, 'png', 'image/png');
        setHistory(startHistory(harnessVersion(asset).recipe));
        setPhase({ kind: 'grading', layer, asset });
      },
      (err: unknown) => {
        if (isLive) setPhase({ kind: 'failed', message: `Nothing to grade: ${describe(err)}` });
      },
    );
    return () => {
      isLive = false;
    };
  }, [session]);

  const step = useCallback((recipe: Recipe, label: string) => {
    setHistory((h) => (h ? pushStep(h, recipe, label) : h));
  }, []);

  const handleEdit = useCallback(
    (changes: Readonly<Record<string, Json>>, label: string) => {
      if (history) step(applyChanges(history.present, changes), label);
    },
    [history, step],
  );

  const layer = phase.kind === 'grading' ? phase.layer : null;
  const loadOriginal = useCallback(async (): Promise<Blob> => {
    if (!layer) throw new Error('No layer is open');
    return new Blob([layer.pixels], { type: LOPSY_LAYER_MIME });
  }, [layer]);

  const version = useMemo(
    () => (phase.kind === 'grading' && history ? harnessVersion(phase.asset, history.present) : null),
    [phase, history],
  );

  const handleCancel = useCallback(() => {
    session.cancel();
    setPhase({ kind: 'finished', message: 'Cancelled. The layer in Lopsy is unchanged.' });
    onFinished();
  }, [session, onFinished]);

  const handleDone = useCallback(
    (renderPng16: () => Promise<ArrayBuffer>, recipe: Recipe) => {
      setPhase({ kind: 'sending' });
      renderPng16().then(
        (png) => {
          if (!session.done(png, recipeJson(recipe))) {
            // Lopsy has been told why; this tab stays open to say so too.
            setPhase({ kind: 'failed', message: 'The graded layer could not be sent back to Lopsy (it is too large or the wrong size).' });
            return;
          }
          setPhase({ kind: 'finished', message: 'Sent to Lopsy. You can close this tab.' });
          onFinished();
        },
        (err: unknown) => {
          session.fail(`The grade could not be rendered: ${describe(err)}`);
          setPhase({ kind: 'failed', message: `The grade could not be rendered: ${describe(err)}` });
        },
      );
    },
    [session, onFinished],
  );

  if (phase.kind === 'grading' && version) {
    return (
      <div className={styles.screen} data-testid="grade-screen">
        <EditView
          asset={phase.asset}
          version={version}
          loadOriginal={loadOriginal}
          onEdit={handleEdit}
          onSetRecipe={step}
          onUndo={() => setHistory((h) => (h ? undoStep(h) : h))}
          onRedo={() => setHistory((h) => (h ? redoStep(h) : h))}
          onClose={handleCancel}
          closeLabel="Cancel"
          onDone={handleDone}
        />
      </div>
    );
  }

  const words =
    phase.kind === 'waiting'
      ? 'Waiting for the layer from Lopsy…'
      : phase.kind === 'sending'
        ? 'Sending the graded layer to Lopsy…'
        : phase.kind === 'grading'
          ? 'Opening the layer…'
          : phase.message;
  return (
    <main className={styles.message} data-testid="grade-screen" data-phase={phase.kind}>
      <h1 className={styles.title}>Grade in Photonamous</h1>
      <p className={phase.kind === 'failed' ? styles.error : styles.hint} role="status">
        {words}
      </p>
    </main>
  );
}
