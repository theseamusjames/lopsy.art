import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { layerSummary, requireDocument, resolveLayer, type LayerSummary } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { layerCreationRefusal } from '../../app/store/document-slice';
import { mergeDownRefusal } from '../../app/store/actions/merge-down';
import { computeDropLayer, type LayerDropTarget } from '../../app/store/actions/drop-layer';
import { currentDropTarget } from '../../panels/LayerPanel/drop-target';
import { blendModeGroupsFor } from '../../components/BlendModeSelect/blend-mode-groups';
import { getColorModeCapabilities } from '../../utils/color-mode-capabilities';
import { findParentGroup, isAncestorOf, isGroupLayer } from '../../layers/group-utils';
import type { BlendMode, DocumentState, Layer } from '../../types';

const ALL_BLEND_MODES = blendModeGroupsFor(true, true).flatMap((group) => group.modes);

const layerRefSpec = {
  type: 'string',
  optional: true,
  description: 'A layer id, or an exact layer name. Omitted means the active layer.',
} as const;

const requiredLayerRefSpec = { type: 'string', description: 'A layer id, or an exact layer name.' } as const;

const nameSpec = (what: string) =>
  ({
    type: 'string',
    optional: true,
    minLength: 1,
    description: `The ${what}'s name. Surrounding spaces are trimmed, as the Layers panel's rename field does.`,
  }) as const;

export interface CreatedLayer {
  id: string;
}

export interface RemovedLayers {
  /** Every layer that was removed, a group's contents included. */
  removed: string[];
  activeLayer: string | null;
}

export interface LayerSelectionResult {
  activeLayer: string | null;
  /** Panel order, top to bottom. */
  selectedLayers: string[];
}

export interface LayerState extends LayerSummary {
  visible: boolean;
  locked: boolean;
  /** Percent, 0-100. */
  opacity: number;
  blendMode: BlendMode;
}

function store() {
  return useEditorStore.getState();
}

function currentDocument(): DocumentState {
  return store().document;
}

function activeLayerId(): string | null {
  return currentDocument().activeLayerId;
}

function isRootGroup(doc: DocumentState, layer: Layer): boolean {
  return layer.id === doc.rootGroupId;
}

function assertCanCreateLayer(doc: DocumentState): void {
  const refusal = layerCreationRefusal(doc);
  if (refusal) throw refusalError(refusal);
}

function trimmedName(commandId: string, name: string): string {
  const trimmed = name.trim();
  if (trimmed) return trimmed;
  throw new CommandError('invalid', `${commandId}: name must contain something other than spaces`);
}

function optionalName(commandId: string, name: string | undefined): string | undefined {
  return name === undefined ? undefined : trimmedName(commandId, name);
}

/** What a plain click on a layer row does that a plain module can reach. */
function selectReplace(id: string): void {
  store().setActiveLayer(id);
  useUIStore.getState().setMaskEditMode(false);
}

function activateIfOther(id: string): void {
  if (activeLayerId() !== id) selectReplace(id);
}

function createdActiveLayer(): CreatedLayer {
  const id = activeLayerId();
  if (!id) throw new Error('The new layer did not become active');
  return { id };
}

function removedSince(before: DocumentState): RemovedLayers {
  const doc = currentDocument();
  const remaining = new Set(doc.layers.map((layer) => layer.id));
  return {
    removed: before.layerOrder.filter((id) => !remaining.has(id)),
    activeLayer: doc.activeLayerId,
  };
}

function displayOrder(doc: DocumentState, ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  return [...doc.layerOrder].reverse().filter((id) => wanted.has(id));
}

function selectionResult(): LayerSelectionResult {
  const doc = currentDocument();
  return { activeLayer: doc.activeLayerId, selectedLayers: displayOrder(doc, doc.selectedLayerIds) };
}

function refuse(reason: string): never {
  throw new CommandError('refused', reason);
}

export const layerAdd = defineCommand({
  id: 'layer.add',
  summary:
    'Adds an empty raster layer above the active layer, inside its group, and makes it active, as the Layers panel\'s Add Layer button does; a `name` renames it afterwards as a rename in the panel does (a second "Rename Layer" history step). Returns its id.',
  surface: 'document',
  params: { name: nameSpec('new layer') },
  run({ name }): CreatedLayer {
    const doc = requireDocument();
    const newName = optionalName('layer.add', name);
    assertCanCreateLayer(doc);
    store().addLayer();
    const created = createdActiveLayer();
    if (newName !== undefined) store().renameLayer(created.id, newName);
    return created;
  },
});

export const layerAddGroup = defineCommand({
  id: 'layer.add-group',
  summary:
    'Adds an empty group above the active layer, inside its group, and makes it active, as the Layers panel\'s New Group button does (no history step, as there). Returns its id.',
  surface: 'document',
  params: { name: { ...nameSpec('new group'), description: 'The new group\'s name; "Group" when omitted. Surrounding spaces are trimmed.' } },
  run({ name }): CreatedLayer {
    const doc = requireDocument();
    const newName = optionalName('layer.add-group', name);
    assertCanCreateLayer(doc);
    store().addGroup(newName);
    return createdActiveLayer();
  },
});

export const layerRemove = defineCommand({
  id: 'layer.remove',
  summary:
    'Deletes one layer (a group with everything in it), as the Delete key does for the active layer with no pixel selection ("Delete Layer" in the history). Returns the removed ids and the new active layer.',
  surface: 'document',
  params: { layer: layerRefSpec },
  run({ layer: ref }): RemovedLayers {
    const doc = requireDocument();
    const layer = resolveLayer(ref);
    if (isRootGroup(doc, layer)) refuse('The root group cannot be deleted.');
    store().removeLayer(layer.id);
    return removedSince(doc);
  },
});

export const layerRemoveSelected = defineCommand({
  id: 'layer.remove-selected',
  summary:
    'Deletes every selected layer except the root group, as the Layers panel\'s Delete Layer button does ("Delete Layers" in the history). Returns the removed ids and the new active layer.',
  surface: 'document',
  params: {},
  run(): RemovedLayers {
    const doc = requireDocument();
    const deletable = doc.selectedLayerIds.filter((id) => id !== doc.rootGroupId);
    if (doc.layers.length <= 1 || deletable.length === 0) {
      refuse('No deletable layer is selected: the root group cannot be deleted.');
    }
    store().removeSelectedLayers();
    return removedSince(doc);
  },
});

export const layerSelect = defineCommand({
  id: 'layer.select',
  summary:
    'Selects a layer as a click on its row in the Layers panel does: replace makes it the active and only selected layer (and leaves mask edit mode), toggle adds it to or removes it from the selection (Cmd-click), range selects every row from the active layer to it (Shift-click). Returns the active layer and the selected layers.',
  surface: 'document',
  params: {
    layer: requiredLayerRefSpec,
    mode: {
      type: 'string',
      enum: ['replace', 'toggle', 'range'],
      default: 'replace',
      description: 'replace: a plain click. toggle: a Cmd-click; the active layer cannot be toggled off. range: a Shift-click; with no active layer it acts as a plain click, as in the panel.',
    },
  },
  run({ layer: ref, mode }): LayerSelectionResult {
    requireDocument();
    const layer = resolveLayer(ref);
    const activeId = activeLayerId();
    if (mode === 'toggle') {
      if (layer.id === activeId) refuse('The active layer always stays selected: make another layer active first.');
      store().toggleLayerSelection(layer.id);
    } else if (mode === 'range' && activeId) {
      store().selectLayerRange(activeId, layer.id);
    } else {
      selectReplace(layer.id);
    }
    return selectionResult();
  },
});

const SET_PROPERTIES = ['name', 'visible', 'locked', 'opacity', 'blendMode'] as const;

interface LayerChanges {
  name?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
}

function offeredBlendModes(doc: DocumentState, layer: Layer): readonly BlendMode[] {
  const allowHsl = getColorModeCapabilities(doc.colorMode).hasHslBlendModes;
  return blendModeGroupsFor(isGroupLayer(layer), allowHsl).flatMap((group) => group.modes);
}

function assertBlendModeOffered(doc: DocumentState, layer: Layer, mode: BlendMode): void {
  if (offeredBlendModes(doc, layer).includes(mode)) return;
  if (mode === 'pass-through') refuse('pass-through is only for groups.');
  refuse(`The ${mode} blend mode is not available in ${doc.colorMode} documents.`);
}

function assertChangeable(doc: DocumentState, layer: Layer, changes: LayerChanges): void {
  const rootOnly = (['visible', 'opacity', 'blendMode'] as const).filter((key) => changes[key] !== undefined);
  if (isRootGroup(doc, layer) && rootOnly.length > 0) {
    refuse(`The root group has no ${rootOnly.join(', ')} of its own to change.`);
  }
  if (changes.blendMode !== undefined) assertBlendModeOffered(doc, layer, changes.blendMode);
}

function applyChanges(layer: Layer, changes: LayerChanges): void {
  const { name, visible, locked, opacity, blendMode } = changes;
  if (name !== undefined) store().renameLayer(layer.id, name);
  if (visible !== undefined && visible !== layer.visible) store().toggleLayerVisibility(layer.id);
  if (locked !== undefined && locked !== layer.locked) store().toggleLayerLock(layer.id);
  if (opacity !== undefined && opacity / 100 !== layer.opacity) {
    store().pushHistoryMetadata('Change Opacity');
    store().updateLayerOpacity(layer.id, opacity / 100);
  }
  if (blendMode !== undefined && blendMode !== layer.blendMode) {
    store().pushHistoryMetadata('Change Blend Mode');
    store().updateLayerBlendMode(layer.id, blendMode);
  }
}

function layerState(id: string): LayerState {
  const layer = currentDocument().layers.find((l) => l.id === id);
  if (!layer) throw new Error(`Layer ${id} vanished during layer.set`);
  return {
    ...layerSummary(layer),
    visible: layer.visible,
    locked: layer.locked,
    opacity: Math.round(layer.opacity * 100),
    blendMode: layer.blendMode,
  };
}

export const layerSet = defineCommand({
  id: 'layer.set',
  summary:
    'Changes a layer\'s name, visibility, lock, opacity or blend mode, each as one committed change in the UI would (rename field, eye and lock buttons, opacity slider, Blend menu), applied in that order with one history step per property that changes; returns the layer\'s properties after.',
  surface: 'document',
  params: {
    layer: layerRefSpec,
    name: { ...nameSpec('layer'), description: 'New name. Surrounding spaces are trimmed, as the rename field does ("Rename Layer").' },
    visible: { type: 'boolean', optional: true, description: 'Shown or hidden ("Toggle Visibility"). Not for the root group.' },
    locked: { type: 'boolean', optional: true, description: 'Locked or unlocked ("Lock Layer" / "Unlock Layer").' },
    opacity: {
      type: 'number',
      optional: true,
      integer: true,
      min: 0,
      max: 100,
      description: 'Percent, 0-100, as the Layers panel\'s opacity slider ("Change Opacity"). Not for the root group.',
    },
    blendMode: {
      type: 'string',
      optional: true,
      enum: ALL_BLEND_MODES,
      description: 'As the Blend menu ("Change Blend Mode"). pass-through is for groups only; hue, saturation, color and luminosity need a colour mode that offers them. Not for the root group.',
    },
  },
  run({ layer: ref, ...rawChanges }): LayerState {
    const doc = requireDocument();
    const layer = resolveLayer(ref);
    if (SET_PROPERTIES.every((key) => rawChanges[key] === undefined)) {
      throw new CommandError('invalid', `layer.set: pass at least one of ${SET_PROPERTIES.join(', ')}`);
    }
    const changes: LayerChanges = { ...rawChanges, name: optionalName('layer.set', rawChanges.name) };
    assertChangeable(doc, layer, changes);
    applyChanges(layer, changes);
    return layerState(layer.id);
  },
});

export const layerDuplicate = defineCommand({
  id: 'layer.duplicate',
  summary:
    'Duplicates a layer (a group with everything in it) as "<name> copy" directly above it, as the Layers panel\'s Duplicate Layer button does; a `layer` other than the active one is made active first, as a click on its row would, and the copy then becomes active. Returns the copy\'s id.',
  surface: 'document',
  params: { layer: layerRefSpec },
  run({ layer: ref }): CreatedLayer {
    const doc = requireDocument();
    const layer = resolveLayer(ref);
    if (isRootGroup(doc, layer)) refuse('The root group cannot be duplicated: the Duplicate Layer button is disabled while it is active.');
    assertCanCreateLayer(doc);
    activateIfOther(layer.id);
    store().duplicateLayer();
    return createdActiveLayer();
  },
});

export const layerMergeDown = defineCommand({
  id: 'layer.merge-down',
  summary:
    'Merges a layer into the layer directly below it in the same group, as Layer > Merge Down does; a `layer` other than the active one is made active first, as a click on its row would. Returns the id of the merged layer, which is active after.',
  surface: 'document',
  params: { layer: layerRefSpec },
  run({ layer: ref }): CreatedLayer {
    const doc = requireDocument();
    const layer = resolveLayer(ref);
    const refusal = mergeDownRefusal({ ...doc, activeLayerId: layer.id });
    if (refusal) throw refusalError(refusal);
    activateIfOther(layer.id);
    store().mergeDown();
    return createdActiveLayer();
  },
});

export const layerFlatten = defineCommand({
  id: 'layer.flatten',
  summary:
    'Composites every visible layer into one "Background" layer, as Layer > Flatten Image does; returns its id once the flatten has finished.',
  surface: 'document',
  params: {},
  run(): Promise<CreatedLayer> {
    const doc = requireDocument();
    if (doc.layers.length <= 1) refuse('There is nothing to flatten.');
    return store().flattenImage().then(createdActiveLayer);
  },
});

type DropPosition = 'above' | 'below' | 'inside';

function assertDroppable(doc: DocumentState, layer: Layer, target: Layer, position: DropPosition): void {
  if (isRootGroup(doc, layer)) refuse('The root group cannot be moved.');
  if (target.id === layer.id) refuse('A layer cannot be placed relative to itself.');
  if (isAncestorOf(doc.layers, layer.id, target.id)) {
    refuse(`"${target.name}" is inside "${layer.name}": a group cannot be moved into itself.`);
  }
  if (position === 'inside' && !isGroupLayer(target)) refuse(`"${target.name}" is not a group: only a group can take a layer inside it.`);
  if (position !== 'inside' && isRootGroup(doc, target)) {
    refuse('Nothing can be placed above or below the root group: use position "inside" for the top of the document.');
  }
}

function dropTarget(doc: DocumentState, target: Layer, position: DropPosition): LayerDropTarget {
  if (position === 'inside') return { parentId: target.id, belowId: null };
  const parent = findParentGroup(doc.layers, target.id);
  if (!parent) refuse(`"${target.name}" is in no group.`);
  if (position === 'below') return { parentId: parent.id, belowId: target.id };
  return currentDropTarget(doc.layers, doc.layerOrder, target.id) ?? { parentId: parent.id, belowId: null };
}

export const layerReorder = defineCommand({
  id: 'layer.reorder',
  summary:
    'Moves a layer (a group with everything in it) directly above or below another layer in that layer\'s group, or to the top of a group (inside), as dragging its row in the Layers panel does ("Reorder Layer"). Returns the id of the group it is in after.',
  surface: 'document',
  params: {
    layer: requiredLayerRefSpec,
    target: { type: 'string', description: 'The layer to place it next to, or the group to place it in: an id or an exact name.' },
    position: {
      type: 'string',
      enum: ['above', 'below', 'inside'],
      description: 'Panel order: above or below `target`, in target\'s group; inside: at the top of the group `target`.',
    },
  },
  run({ layer: ref, target: targetRef, position }): { parent: string } {
    const doc = requireDocument();
    const layer = resolveLayer(ref);
    const target = resolveLayer(targetRef);
    assertDroppable(doc, layer, target, position);
    const drop = dropTarget(doc, target, position);
    if (!computeDropLayer(doc, store().renderVersion, layer.id, drop)) {
      refuse(`"${layer.name}" is already ${position} "${target.name}".`);
    }
    store().dropLayer(layer.id, drop);
    return { parent: drop.parentId };
  },
});

function resolveDistinctLayers(doc: DocumentState, refs: readonly string[]): string[] {
  const ids: string[] = [];
  for (const ref of refs) {
    const layer = resolveLayer(ref);
    if (isRootGroup(doc, layer)) throw new CommandError('invalid', 'layer.group: the root group cannot be grouped');
    if (!ids.includes(layer.id)) ids.push(layer.id);
  }
  return ids;
}

export const layerGroup = defineCommand({
  id: 'layer.group',
  summary:
    'Puts layers in a new group named "Group" where the topmost of them was, as Layer > Group Layers does, even for a single layer; `layers` become the selection first, as Cmd-clicking them would, otherwise the selected layers are grouped (with nothing but the root group selected, an empty group is added, as the menu does). Returns the group\'s id, which is active after.',
  surface: 'document',
  params: {
    layers: {
      type: 'array',
      optional: true,
      minItems: 1,
      items: { type: 'string' },
      description: 'Layer ids or exact names. Omitted means the selected layers.',
    },
  },
  run({ layers: refs }): CreatedLayer {
    const doc = requireDocument();
    const ids = refs === undefined ? undefined : resolveDistinctLayers(doc, refs);
    assertCanCreateLayer(doc);
    if (ids) store().setLayerSelection(ids);
    store().groupSelectedLayers();
    return createdActiveLayer();
  },
});
