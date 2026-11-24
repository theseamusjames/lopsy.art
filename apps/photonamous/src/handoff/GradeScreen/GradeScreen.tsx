import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Asset, Json } from '@lopsy/photos-core/library/types';
import type { GradeSession } from '@lopsy/handoff/grade';
import type { GradeLayer, GradeRecipe } from '@lopsy/handoff/messages';
import { EditView } from '../../edit/EditView/EditView';
import { applyChanges } from '../../edit/edit-controls';
import { harnessAsset, harnessVersion } from '../../edit/EditHarness/harness-asset';
import { pushStep, redoStep, startHistory, undoStep, type RecipeHistory } from '../../edit/EditHarness/recipe-history';
import { useDocumentTitle } from '../../edit/edit-page';
import { LOPSY_LAYER_MIME } from '../../engine/lopsy-layer';
import { showErrorToast } from '../../app/toasts';
import { Toasts } from '../../components/Toasts/Toasts';
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
 * sends nothing. While it waits or sends, the page is its heading and a
 * status line, which takes focus so a screen reader hears where it is.
 */
export function GradeScreen({ session, onFinished }: GradeScreenProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting' });
  const [history, setHistory] = useState<RecipeHistory | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useDocumentTitle('Grade – Photonamous');

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
  const isGrading = phase.kind === 'grading' && version !== null;

  useEffect(() => {
    if (!isGrading) headingRef.current?.focus();
  }, [isGrading]);

  /**
   * Set while Done renders the grade. The Edit view stays mounted until the
   * render has answered: its engine draws it, and on WebGPU the read answers
   * a frame or more later, after an unmounted view would have freed it. So
   * Cancel during the render waits for it, and then sends nothing.
   */
  const sending = useRef<Promise<void> | null>(null);
  const isCancelled = useRef(false);

  const handleCancel = useCallback(() => {
    if (isCancelled.current) return;
    isCancelled.current = true;
    const finish = () => {
      session.cancel();
      setPhase({ kind: 'finished', message: 'Cancelled. The layer in Lopsy is unchanged.' });
      onFinished();
    };
    const pending = sending.current;
    // The render's own handler catches everything, so this always runs.
    if (pending) void pending.then(finish);
    else finish();
  }, [session, onFinished]);

  const handleDone = useCallback(
    (renderPng16: () => Promise<ArrayBuffer>, recipe: Recipe) => {
      if (sending.current || isCancelled.current) return;
      const send = async (): Promise<void> => {
        let png: ArrayBuffer;
        try {
          png = await renderPng16();
        } catch (err) {
          if (isCancelled.current) return;
          session.fail(`The grade could not be rendered: ${describe(err)}`);
          setPhase({ kind: 'failed', message: `The grade could not be rendered: ${describe(err)}` });
          return;
        }
        // Cancel was chosen while the render was out: nothing goes back to Lopsy.
        if (isCancelled.current) return;
        try {
          if (!session.done(png, recipeJson(recipe))) {
            // Lopsy has been told why; this tab stays open to say so too.
            setPhase({ kind: 'failed', message: 'The graded layer could not be sent back to Lopsy (it is too large or the wrong size).' });
            return;
          }
        } catch (err) {
          // The Edit view stays, so Done can be tried again or the grade cancelled.
          console.error('Photonamous: the grade could not be sent', err);
          showErrorToast(`The graded layer could not be sent back to Lopsy: ${describe(err)}`);
          return;
        }
        setPhase({ kind: 'finished', message: 'Sent to Lopsy. You can close this tab.' });
        onFinished();
      };
      sending.current = send().finally(() => {
        sending.current = null;
      });
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
          documentTitle={`${phase.layer.name} – Grade – Photonamous`}
        />
        <Toasts />
      </div>
    );
  }

  const words =
    phase.kind === 'waiting'
      ? 'Waiting for the layer from Lopsy…'
      : phase.kind === 'grading'
        ? 'Opening the layer…'
        : phase.message;
  return (
    <main className={styles.message} data-testid="grade-screen" data-phase={phase.kind}>
      <h1 ref={headingRef} className={styles.title} tabIndex={-1}>
        Grade in Photonamous
      </h1>
      {phase.kind === 'failed' ? (
        <p className={styles.error} role="alert">
          {words}
        </p>
      ) : (
        <p className={styles.hint} role="status">
          {words}
        </p>
      )}
    </main>
  );
}
