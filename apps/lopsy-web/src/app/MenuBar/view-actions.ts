import { useEditorStore } from '../editor-store';
import { nextZoomLevel } from '../../utils/zoom-levels';
import { runningRenderer, storeRenderer, type Renderer } from '../../engine-wasm/renderer-choice';
import { notifyInfo } from '../notifications-store';

const RENDERER_NAMES: Record<Renderer, string> = { webgl: 'WebGL', wgpu: 'WebGPU' };

/** View > Zoom In / Zoom Out: the next zoom level from the store's zoom. */
export function zoomStep(direction: 'in' | 'out'): void {
  const state = useEditorStore.getState();
  state.setZoom(nextZoomLevel(state.viewport.zoom, direction));
}

/** View > Fit to Screen: 90% of the canvas area the store last measured, when it has measured one. */
export function fitToScreen(): void {
  const state = useEditorStore.getState();
  const { width, height } = state.document;
  const vp = state.viewport;
  if (vp.width > 0 && vp.height > 0) {
    state.setZoom(Math.min(vp.width / width, vp.height / height) * 0.9);
    state.setPan(0, 0);
  }
}

/** View > Actual Size. */
export function actualSize(): void {
  useEditorStore.getState().setZoom(1);
  useEditorStore.getState().setPan(0, 0);
}

/**
 * View > Renderer. The engine's two builds are separate downloads, chosen
 * before either is fetched, so a new choice takes effect on the next page load.
 */
export function chooseRenderer(renderer: Renderer): void {
  storeRenderer(renderer);
  const name = RENDERER_NAMES[renderer];
  notifyInfo(
    runningRenderer() === renderer
      ? `Lopsy is using the ${name} renderer.`
      : `Lopsy will use the ${name} renderer the next time it loads. Reload the page to switch now.`,
  );
}
