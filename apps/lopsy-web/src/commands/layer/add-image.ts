import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { base64Spec, decodeBase64, requireDocument, requireEngine } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { describeError } from '../../app/notifications-store';
import { pasteOrOpenBlob, type PasteOrOpenOutcome } from '../../app/paste-or-open';
import { tooLargeFrom, tooLargeMessage } from '../../io/image-too-large';

function addedLayerId(before: ReadonlySet<string>): string {
  const added = useEditorStore.getState().document.layers.find((layer) => !before.has(layer.id));
  if (!added) throw new Error('layer.add-image: no layer was added');
  return added.id;
}

export const layerAddImage = defineCommand({
  id: 'layer.add-image',
  summary:
    'Adds an image file to the open document as a new "Pasted Layer", as dropping the file on the canvas does ("Paste"): it goes above the active layer, shrinks to fit when larger than the canvas, its pixels become the selection and the Move tool is chosen. An image larger than this device can hold is refused (\'refused\'), saying its size and the largest side allowed, with nothing added. Returns the new layer\'s id.',
  surface: 'document',
  params: {
    base64: base64Spec('The image file\'s bytes (PNG, JPEG, GIF, BMP or WebP)'),
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 255,
      description: 'The file name. A drop onto an open document does not use it: the layer is always named "Pasted Layer".',
    },
  },
  run({ base64, name }): Promise<{ id: string }> {
    requireDocument();
    requireEngine();
    const blob = new Blob([decodeBase64('layer.add-image', 'base64', base64) as BlobPart]);
    const before = new Set(useEditorStore.getState().document.layers.map((layer) => layer.id));
    return pasteOrOpenBlob(blob, name.replace(/\.[^.]+$/, '')).then(
      async ({ selected }: PasteOrOpenOutcome) => {
        useUIStore.getState().closeModalOfKind('newDocument');
        const id = addedLayerId(before);
        await selected;
        return { id };
      },
      (err: unknown) => {
        // Too large for this device: the reason the UI's message over the canvas gives, and nothing shown there.
        const tooLarge = tooLargeFrom(err);
        if (tooLarge) {
          const { title, body } = tooLargeMessage({ kind: 'image', name, width: tooLarge.width, height: tooLarge.height }, tooLarge.limit);
          throw new CommandError('refused', `layer.add-image: ${title}: ${body}`);
        }
        throw new CommandError('invalid', `layer.add-image: could not decode ${JSON.stringify(name)} as an image: ${describeError(err)}`);
      },
    );
  },
});
