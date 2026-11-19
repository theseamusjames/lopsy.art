import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { activateIfOther, coordinateSpec, extentSpec, layerRefSpec, ownEntry, requireDocument, requireEngine, resolveLayer } from '../context';
import { documentEnvironment, gestureNote, runGesture } from '../gesture/run-gesture';
import { TOOL_OPTIONS, checkOption } from '../tool/tool-options';
import { hasOwnKey } from '../params';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { findFontEntry } from '../../app/local-fonts-store';
import { insertIntoEditedText, selectAllEditedText } from '../../app/text-edit-buffer';
import { commitTextEditing, textLayerAt } from '../../tools/text/text-interaction';
import {
  applyDiscreteTextSetting,
  applyTextFontFamily,
  applyTextSetting,
  applyTextWeight,
  beginTextLayerHistory,
  endTextLayerHistory,
} from '../../tools/text/apply-text-setting';
import { buildFontFamilyValue, extractFamilyName } from '../../utils/font-loader';
import { getLayerTextureDimensions, isFontLoaded, type Engine } from '../../engine-wasm/wasm-bridge';
import type { TextSettings } from '../../tools/text/text-settings';
import type { FontEntry } from '../../utils/font-catalog';
import type { FontStyle, Layer, Point, TextLayer } from '../../types';

export interface TextLayerResult {
  id: string;
  name: string;
}

export interface FontLoadResult {
  /** false when the font had not loaded after FONT_WAIT_MS: the change is made, drawn in a fallback face until it arrives. */
  fontLoaded: boolean;
}

export interface TextFontResult extends FontLoadResult {
  family: string;
  weight: number;
  style: FontStyle;
}

export interface TextStyleResult extends TextLayerResult {
  options: Record<string, unknown>;
}

/** How long a command waits for a web font it needs before giving up: two fetches with the loader's 8 s timeout, and slack. */
export const FONT_WAIT_MS = 20_000;
const FONT_POLL_MS = 50;

/** Whether text in `fontFamily` would still change once a font load lands: a catalog or installed family the engine does not have yet. */
function isFontPending(engine: Engine, fontFamily: string): boolean {
  const name = extractFamilyName(fontFamily);
  const entry = findFontEntry(name);
  if (!entry || entry.source === 'system') return false;
  return !isFontLoaded(engine, name);
}

/**
 * Resolves true once the engine has the family, so the text it renders (a
 * commit, or the re-render the loader runs when the binary lands) shows the
 * real glyphs; false when it has not arrived after FONT_WAIT_MS. The text
 * change is made either way, so a timeout is no failure: a caller that
 * retried would make it twice.
 */
async function fontReady(engine: Engine, fontFamily: string): Promise<boolean> {
  const deadline = Date.now() + FONT_WAIT_MS;
  while (isFontPending(engine, fontFamily)) {
    if (Date.now() > deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, FONT_POLL_MS));
  }
  return true;
}

const FONT_WAIT_NOTE = `Resolves once the font is loaded and the text is drawn with it, or after ${FONT_WAIT_MS / 1000} s without it: fontLoaded is then false, the change is made all the same and shows a fallback face until the font arrives, so do not run the command again.`;

function textLayer(id: string): TextLayer {
  const layer = useEditorStore.getState().document.layers.find((l) => l.id === id);
  if (layer?.type !== 'text') throw new Error(`the text layer ${id} is gone`);
  return layer;
}

function checkNotEditing(): void {
  if (useUIStore.getState().textEditing) {
    throw new CommandError('refused', 'Text is being edited: commit it first (for example with tool.select).');
  }
}

function checkHasText(id: string, text: string): void {
  if (!/\S/.test(text)) throw new CommandError('invalid', `${id}: text is empty or only whitespace, which a commit discards.`);
}

/** Types `text` into the session the click opened (the paste / input-event path) and commits it, as Tab does. */
function typeAndCommit(text: string): void {
  insertIntoEditedText(text);
  commitTextEditing();
}

function editedLayerId(what: string): string {
  const editing = useUIStore.getState().textEditing;
  if (!editing) {
    throw new CommandError('refused', `${what}: the Text-tool click did not open a text box there, so nothing was typed.`);
  }
  return editing.layerId;
}

const boxSpec = {
  type: 'object',
  optional: true,
  description: 'Box (paragraph) text: the Text tool is dragged from (x, y) to (x + width, y + height) and lines wrap at the width. Omitted: point text, a click.',
  fields: {
    width: extentSpec('Document pixels; a drag of 4 px or less is a click.', { integer: true, min: 5 }),
    height: extentSpec('Document pixels.', { integer: true, min: 5 }),
  },
} as const;

export const textAdd = defineCommand({
  id: 'text.add',
  summary:
    'Adds a text layer as the Text tool does: a click at (x, y) for point text, or a drag for box text, then `text` typed (\\n starts a new line, as Enter does) and committed, as Tab does. It uses the current Text options, font and foreground colour (tool.set, text.set-font, color.set). Two history steps ("Add Text Layer", "Text"); the layer is named after its text. Refused while text is being edited and where a click at (x, y) would edit an existing text layer instead (use text.edit). Returns the new layer\'s id and name, and fontLoaded. ' + FONT_WAIT_NOTE + gestureNote('the Text tool'),
  surface: 'document',
  params: {
    x: coordinateSpec('Document x of the click, (0,0) at the top-left: the text\'s anchor.'),
    y: coordinateSpec('Document y of the click.'),
    text: { type: 'string', minLength: 1, maxLength: 100_000, description: 'The text; \\n for a line break.' },
    box: boxSpec,
  },
  async run({ x, y, text, box }): Promise<TextLayerResult & FontLoadResult> {
    requireDocument();
    const engine = requireEngine();
    checkHasText('text.add', text);
    checkNotEditing();
    const press = documentEnvironment.toCanvas(x, y) ?? { x, y };
    const hit = textLayerAt(press);
    if (hit) {
      throw new CommandError('refused', `A Text-tool click at (${x}, ${y}) would edit the text layer "${hit.name}" instead of adding one: use text.edit, or pick a point outside it.`);
    }
    const points: Point[] = box ? [{ x, y }, { x: x + box.width, y: y + box.height }] : [{ x, y }];
    runGesture({ tool: 'text', points });
    const id = editedLayerId('text.add');
    typeAndCommit(text);
    const layer = textLayer(id);
    const fontLoaded = await fontReady(engine, layer.fontFamily);
    return { id, name: textLayer(id).name, fontLoaded };
  },
});

/** A point a Text-tool click enters editing on `layer` at: the middle of its texture, if the hit test gives it this layer. */
function clickPointOn(engine: Engine, layer: TextLayer): Point {
  const [width = 0, height = 0] = getLayerTextureDimensions(engine, layer.id) ?? [];
  const point = { x: Math.round(layer.x + width / 2), y: Math.round(layer.y + height / 2) };
  if (textLayerAt(point)?.id !== layer.id) {
    throw new CommandError('refused', `A Text-tool click cannot reach "${layer.name}": it is hidden, locked, empty or covered by another text layer.`);
  }
  return point;
}

function requireTextLayer(layer: Layer): TextLayer {
  if (layer.type !== 'text') throw new CommandError('refused', `"${layer.name}" is not a text layer.`);
  return layer;
}

export const textEdit = defineCommand({
  id: 'text.edit',
  summary:
    'Replaces a text layer\'s text as a user would: a Text-tool click inside it opens it for editing (its font, size and colour become the Text options, as the click does), Cmd+A selects all of it, `text` is typed over it and committed, as Tab does. One history step ("Text"); a layer still named after its old text is renamed after the new one. Refused while text is being edited, and for a layer a click cannot reach (hidden, locked, empty or covered by another text layer). Returns the layer\'s id and name, and fontLoaded. ' + FONT_WAIT_NOTE + gestureNote('the Text tool'),
  surface: 'document',
  params: {
    layer: layerRefSpec,
    text: { type: 'string', minLength: 1, maxLength: 100_000, description: 'The new text; \\n for a line break.' },
  },
  async run({ layer: ref, text }): Promise<TextLayerResult & FontLoadResult> {
    requireDocument();
    const engine = requireEngine();
    const layer = requireTextLayer(resolveLayer(ref));
    checkHasText('text.edit', text);
    checkNotEditing();
    runGesture({ tool: 'text', points: [clickPointOn(engine, layer)] });
    if (editedLayerId('text.edit') !== layer.id) throw new Error('text.edit: the click opened another layer');
    selectAllEditedText();
    typeAndCommit(text);
    const fontLoaded = await fontReady(engine, textLayer(layer.id).fontFamily);
    return { id: layer.id, name: textLayer(layer.id).name, fontLoaded };
  },
});

function fontEntry(family: string): FontEntry {
  const entry = findFontEntry(family);
  if (!entry) {
    throw new CommandError('refused', `"${family}" is not in the font picker: pass a family name exactly as the picker lists it (installed fonts appear there once the browser has granted access to them).`);
  }
  return entry;
}

function checkWeight(entry: FontEntry, weight: number | undefined): void {
  if (weight === undefined || entry.weights.includes(weight)) return;
  throw new CommandError('invalid', `text.set-font: ${entry.family} offers the weights ${entry.weights.join(', ')}, not ${weight}.`);
}

function fontResult(fontLoaded: boolean): TextFontResult {
  const text = useToolSettingsStore.getState().settings.text;
  return { family: extractFamilyName(text.fontFamily), weight: text.fontWeight, style: text.fontStyle, fontLoaded };
}

export const textSetFont = defineCommand({
  id: 'text.set-font',
  summary:
    'Sets the Text font as the options bar\'s font picker does, then its Weight and Style selects when given: new text uses it, and, as in the UI, the active text layer (or the text being edited) is restyled too, one "Text" history step per change. Refused for a family the picker does not list; the weight must be one the family offers. Returns the font family, weight and style now set, and fontLoaded. ' + FONT_WAIT_NOTE,
  surface: 'document',
  params: {
    family: { type: 'string', minLength: 1, maxLength: 200, description: 'A family name as the font picker lists it, e.g. "Montserrat".' },
    weight: { type: 'number', integer: true, optional: true, description: 'A weight the family offers (100-1000), as the Font weight select lists them. Omitted: the current weight, snapped to the nearest the family has.' },
    style: { type: 'string', enum: ['normal', 'italic'], optional: true, description: 'Omitted: unchanged.' },
  },
  async run({ family, weight, style }): Promise<TextFontResult> {
    requireDocument();
    const engine = requireEngine();
    const entry = fontEntry(family);
    checkWeight(entry, weight);
    const value = buildFontFamilyValue(entry.family, entry.category);
    const loads = [applyTextFontFamily(value)];
    const settings = () => useToolSettingsStore.getState().settings.text;
    if (weight !== undefined && weight !== settings().fontWeight) loads.push(applyTextWeight(weight));
    if (style !== undefined && style !== settings().fontStyle) loads.push(applyDiscreteTextSetting('fontStyle', style));
    await Promise.all(loads);
    return fontResult(await fontReady(engine, value));
  },
});

const TEXT_OPTIONS = TOOL_OPTIONS.text;

function checkStyleOptions(options: Record<string, unknown>): void {
  const names = Object.keys(options);
  const valid = Object.keys(TEXT_OPTIONS).join(', ');
  if (names.length === 0) throw new CommandError('invalid', `text.style: options is empty; valid options: ${valid}`);
  for (const name of names) {
    const option = ownEntry(TEXT_OPTIONS, name);
    if (!option) throw new CommandError('invalid', `text.style: unknown option ${JSON.stringify(name)}; valid options: ${valid}`);
    checkOption(`options.${name}`, option, options[name], 'text.style');
  }
}

/** One option changed as its control does: the Size slider's typed value is bracketed by its history, a select or toggle is one discrete change. */
function applyStyleOption(key: keyof TextSettings, value: unknown): Promise<void> {
  if (key === 'fontSize') {
    beginTextLayerHistory();
    const done = applyTextSetting('fontSize', value as number);
    endTextLayerHistory();
    return done;
  }
  return applyDiscreteTextSetting(key, value as TextSettings[typeof key]);
}

function styleValues(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(TEXT_OPTIONS).map(([name, option]) => [name, option.read()]));
}

export const textStyle = defineCommand({
  id: 'text.style',
  summary:
    'Restyles a text layer as changing the Text options (options bar or Text panel) with it active does: the layer is made active first, as a click on its row does, and each option that differs from the current value is applied as its control applies it, one "Text" history step each (the options also become the Text options for new text). Options are tool.set\'s text options: fontSize, fontStyle, align, underline, strikethrough, vertical (tool.describe lists their ranges); the font family and weight are text.set-font\'s. Refused while text is being edited and for a layer that is not text. Returns the layer\'s id and name and the text options after.',
  surface: 'document',
  params: {
    layer: layerRefSpec,
    options: { type: 'record', description: 'Option names and values, for example { "fontSize": 48, "align": "center" }.' },
  },
  async run({ layer: ref, options }): Promise<TextStyleResult> {
    requireDocument();
    requireEngine();
    checkStyleOptions(options);
    const layer = requireTextLayer(resolveLayer(ref));
    checkNotEditing();
    activateIfOther(layer.id);
    const loads: Promise<void>[] = [];
    for (const name of Object.keys(TEXT_OPTIONS)) {
      if (!hasOwnKey(options, name) || TEXT_OPTIONS[name]?.read() === options[name]) continue;
      loads.push(applyStyleOption(name as keyof TextSettings, options[name]));
    }
    await Promise.all(loads);
    return { id: layer.id, name: textLayer(layer.id).name, options: styleValues() };
  },
});
