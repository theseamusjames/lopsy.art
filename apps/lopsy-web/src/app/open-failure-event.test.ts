import { describe, expect, it } from 'vitest';
import { ImageTooLargeError } from '../io/image-too-large';
import { openFailureEvent } from './open-failure-event';

const DEVICE = { side: 8192, isDevice: true };

function projectError(message: string): Error {
  const err = new Error(message);
  err.name = 'ProjectFormatError';
  return err;
}

describe('openFailureEvent', () => {
  it('reports a size failure by the side that went over and the limit, without the image’s own size', () => {
    expect(openFailureEvent(new ImageTooLargeError(8200, 64, DEVICE), { kind: 'image', name: 'Wide.png' })).toEqual({
      kind: 'too-large',
      reason: 'Image width exceeded 8192',
      format: 'png',
      limit: 8192,
    });
    expect(openFailureEvent(new ImageTooLargeError(10, 9000, DEVICE, 'project'), { kind: 'project', name: 'Tall.lopsy' })).toEqual({
      kind: 'too-large',
      reason: 'Project height exceeded 8192',
      format: 'lopsy',
      limit: 8192,
    });
  });

  it('recognises the engine’s refusal of a texture as a size failure', () => {
    const err = new Error('texture 9000x100 exceeds the GPU limit of 8192');
    expect(openFailureEvent(err, { kind: 'paste', name: null, format: 'png' })).toEqual({
      kind: 'too-large',
      reason: 'Pasted image width exceeded 8192',
      format: 'png',
      limit: 8192,
    });
  });

  it('never sends the file’s name: an image that will not decode is a fixed sentence, whatever the message says', () => {
    const name = 'Image width exceeded 8192 — Ada at home.png';
    const event = openFailureEvent(new Error(`Failed to open image: ${name}`), { kind: 'image', name });
    expect(event).toEqual({ kind: 'decode-failed', reason: 'Image could not be decoded', format: 'png' });
    expect(JSON.stringify(event)).not.toContain('Ada');
  });

  it('calls a type Lopsy does not read unsupported, and names only a format on the list', () => {
    expect(openFailureEvent(new Error('decode'), { kind: 'image', name: 'scan.tif' })).toEqual({
      kind: 'unsupported-type',
      reason: 'File type not supported',
      format: 'tiff',
    });
    expect(openFailureEvent(new Error('decode'), { kind: 'image', name: 'secret-project.myextension' })).toEqual({
      kind: 'unsupported-type',
      reason: 'File type not supported',
      format: 'other',
    });
  });

  it('passes a RAW refusal’s engine sentence on, shortened, and never one that mentions the file', () => {
    const long = `RAF decode failed: This camera's compressed RAW format isn't supported yet (${'x'.repeat(200)}). Set the camera to "Uncompressed" RAW, or convert it to DNG.`;
    const event = openFailureEvent(new Error(long), { kind: 'image', name: 'DSCF0001.RAF' });
    expect(event).toEqual({ kind: 'raw-refused', reason: "This camera's compressed RAW format isn't supported yet.", format: 'raf' });
    expect(event.reason.length).toBeLessThanOrEqual(100);

    const named = openFailureEvent(new Error('DNG decode failed: Tag ImageWidth not found in Holiday at the lake'), {
      kind: 'image',
      name: 'Holiday at the lake.dng',
    });
    expect(named).toEqual({ kind: 'raw-refused', reason: 'RAW file could not be decoded', format: 'dng' });
  });

  it('gives a PSD the engine’s sentence, and a project only fixed sentences (its messages can name a layer)', () => {
    expect(openFailureEvent(new Error('unsupported color mode 4 (only RGB is supported)'), { kind: 'image', name: 'a.psd' })).toEqual({
      kind: 'decode-failed',
      reason: 'Unsupported color mode 4 (only RGB is supported)',
      format: 'psd',
    });
    const layer = new Error('the pixels of layer "Ada’s passport" could not be decoded (bad data).');
    expect(openFailureEvent(layer, { kind: 'project', name: 'Trip.lopsy' })).toEqual({
      kind: 'decode-failed',
      reason: 'Project could not be loaded',
      format: 'lopsy',
    });
    expect(openFailureEvent(projectError('Corrupt .lopsy file: layer "Ada" has no id'), { kind: 'project', name: 'Trip.lopsy' }).reason).toBe(
      'Project file is damaged',
    );
    expect(openFailureEvent(projectError('Not a valid .lopsy file — missing magic bytes.'), { kind: 'project', name: 'x.lopsy' }).reason).toBe(
      'Not a Lopsy project',
    );
    expect(
      openFailureEvent(projectError('This .lopsy file was saved with a newer version of Lopsy (format v9). Please update the app.'), {
        kind: 'project',
        name: 'x.lopsy',
      }).reason,
    ).toBe('Project saved by a newer version of Lopsy');
  });

  it('reports a handoff from Photonamous that failed with a fixed sentence and the format it was sent as', () => {
    expect(openFailureEvent(new Error('The connection to 1AbCdriveId closed'), { kind: 'image', name: 'DSCF8078', format: 'png', isHandoff: true })).toEqual({
      kind: 'decode-failed',
      reason: 'Photo from Photonamous could not be received',
      format: 'png',
    });
  });
});
