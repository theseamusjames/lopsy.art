import { useEffect, useRef, useState } from 'react';
import { WebGL2Warning, checkWebGL2Support } from '../components/WebGL2Warning/WebGL2Warning';
import { CanvasRenderer } from '../app/CanvasRenderer';
import { useEditorStore } from '../app/editor-store';
import { useAppEffects } from '../app/hooks/useAppEffects';
import { attachGestureSession } from '../app/interactions/gesture-session';
import styles from './AgentApp.module.css';

/**
 * The agent page: the document canvas and nothing else. It is driven
 * through `window.lopsy` (set by the entry), never by input: no menus,
 * panels, shortcuts or pointer handlers are mounted.
 */
export function AgentApp() {
  const [hasWebGL2] = useState(() => checkWebGL2Support());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const documentReady = useEditorStore((s) => s.documentReady);

  useAppEffects({ canvasRef, containerRef, documentReady });

  // The gesture commands' Move float, as the editor's canvas hook attaches it.
  useEffect(() => attachGestureSession(), []);

  if (!hasWebGL2) {
    return <WebGL2Warning />;
  }

  // As in the editor, the canvas mounts only once a document exists, and the engine starts with it.
  if (!documentReady) {
    return (
      <div className={styles.notice}>
        <p>
          This is Lopsy&rsquo;s agent page. It has no controls: it is driven through{' '}
          <code>window.lopsy</code>. The guide is at <a href="/SKILL.md">/SKILL.md</a>.
        </p>
      </div>
    );
  }

  return (
    <main ref={containerRef} data-testid="canvas-container" className={styles.canvas}>
      <canvas ref={canvasRef} aria-label="Drawing canvas" />
      <canvas ref={overlayCanvasRef} className={styles.overlayCanvas} aria-hidden="true" />
      <CanvasRenderer canvasRef={canvasRef} containerRef={containerRef} overlayCanvasRef={overlayCanvasRef} />
    </main>
  );
}
