import type { Engine } from '../../engine-wasm/wasm-bridge';
import { textCursorRect, textHitPosition } from '../../engine-wasm/wasm-bridge';
import { utf16ToUtf8, utf8ToUtf16 } from '../../engine-wasm/text-offset';
import type { TextGeometry } from './text-input';

/**
 * Build a {@link TextGeometry} backed by the engine's layout for a text layer.
 * Bridges UTF-16 editing offsets ↔ the engine's UTF-8 byte offsets. All
 * coordinates are engine layout space (relative to the text origin), which is
 * what the caret/hit-test consumers work in.
 */
export function makeTextGeometry(
  engine: Engine,
  layerId: string,
  text: string,
): TextGeometry {
  return {
    caretRect(pos: number) {
      const rect = textCursorRect(engine, layerId, utf16ToUtf8(text, pos));
      if (rect.length < 3) return null;
      return { x: rect[0]!, top: rect[1]!, height: rect[2]! };
    },
    hitTest(x: number, y: number) {
      const p = textHitPosition(engine, layerId, x, y);
      return p >= 0 ? utf8ToUtf16(text, p) : null;
    },
  };
}
