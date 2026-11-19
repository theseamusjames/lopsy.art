import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { requireDocument, resolveLayer } from '../context';
import { useEditorStore } from '../../app/editor-store';
import { ADD_MENU_TYPES, adjustmentsPanelGroup } from '../../panels/AdjustmentsPanel/adjustments-panel-target';
import { ADJUSTMENT_NODE_LABELS } from '../../filters/adjustment-node-utils';
import { isAdjustmentAllowedInMode } from '../../utils/color-mode-capabilities';
import { isGroupLayer } from '../../layers/group-utils';
import { checkNodeParams, nodeParamsJson } from './adjust-params';
import type { AdjustmentNode } from '../../types/adjustment-nodes';
import type { GroupLayer } from '../../types';

export interface NodeSummary {
  id: string;
  type: AdjustmentNode['type'];
  enabled: boolean;
  params: Record<string, unknown>;
}

export interface AdjustmentsResult {
  group: string;
  /** Whether the group's adjustments apply (the panel's eye button). */
  enabled: boolean;
  /** In the order they apply, top of the panel first. */
  nodes: NodeSummary[];
}

function store() {
  return useEditorStore.getState();
}

const groupSpec = {
  type: 'string',
  optional: true,
  description:
    'A group layer\'s id or exact name. Omitted means the group the Adjustments panel edits: the active layer when it is a group, otherwise the document\'s root group (which every new document gives a set of default nodes).',
} as const;

const nodeSpec = {
  type: 'string',
  description: 'A node id from adjust.list, or a node type (e.g. "exposure") when the group has exactly one node of that type.',
} as const;

function resolveGroup(ref?: string): GroupLayer {
  const doc = requireDocument();
  if (ref === undefined) {
    const group = adjustmentsPanelGroup(doc);
    if (!group) throw new CommandError('not-found', 'The document has no root group to hold adjustments.');
    return group;
  }
  const layer = resolveLayer(ref);
  if (!isGroupLayer(layer)) {
    throw new CommandError('invalid', `"${layer.name}" is a ${layer.type} layer: adjustment nodes belong to groups; pass a group, or omit group for the root group.`);
  }
  return layer;
}

function resolveNode(group: GroupLayer, ref: string): AdjustmentNode {
  const byId = group.adjustments.find((node) => node.id === ref);
  if (byId) return byId;
  const byType = group.adjustments.filter((node) => node.type === ref);
  const [only] = byType;
  if (byType.length === 1 && only) return only;
  if (byType.length > 1) {
    const ids = byType.map((node) => node.id).join(', ');
    throw new CommandError('invalid', `"${group.name}" has ${byType.length} ${ref} nodes: pass one of their ids: ${ids}`);
  }
  throw new CommandError('not-found', `"${group.name}" has no adjustment node with the id or type ${JSON.stringify(ref)}.`);
}

function currentGroup(id: string): GroupLayer {
  const layer = store().document.layers.find((l) => l.id === id);
  if (!layer || !isGroupLayer(layer)) throw new Error(`Group ${id} vanished during an adjust command`);
  return layer;
}

function summary(node: AdjustmentNode): NodeSummary {
  return { id: node.id, type: node.type, enabled: node.enabled, params: nodeParamsJson(node) };
}

function adjustments(groupId: string): AdjustmentsResult {
  const group = currentGroup(groupId);
  return { group: group.id, enabled: group.adjustmentsEnabled ?? true, nodes: group.adjustments.map(summary) };
}

export const adjustList = defineCommand({
  id: 'adjust.list',
  summary:
    'Lists a group\'s adjustment nodes in the order they apply, with each node\'s id, type, enabled flag and params, and whether the group\'s adjustments are on. Returns { group, enabled, nodes }.',
  surface: 'document',
  params: { group: groupSpec },
  run({ group: ref }): AdjustmentsResult {
    return adjustments(resolveGroup(ref).id);
  },
});

export const adjustAdd = defineCommand({
  id: 'adjust.add',
  summary:
    'Adds an adjustment node with its default params to the end of a group\'s list, as choosing it from the Adjustments panel\'s Add Adjustment menu does ("Add Adjustment"); a pass-through group switches to Normal so the node renders, as in the panel. Types the menu hides for the document\'s colour mode are refused. Returns the new node\'s id and the group\'s adjustments.',
  surface: 'document',
  params: { group: groupSpec, type: { type: 'string', enum: ADD_MENU_TYPES } },
  run({ group: ref, type }): AdjustmentsResult & { id: string } {
    const group = resolveGroup(ref);
    const { colorMode } = store().document;
    if (!isAdjustmentAllowedInMode(type, colorMode)) {
      throw new CommandError('refused', `${ADJUSTMENT_NODE_LABELS[type]} is not offered in ${colorMode} documents: the Add Adjustment menu leaves it out.`);
    }
    store().addAdjustmentNode(group.id, type);
    const { adjustments: nodes } = currentGroup(group.id);
    const added = nodes[nodes.length - 1];
    if (!added) throw new Error('adjust.add: the node was not added');
    return { id: added.id, ...adjustments(group.id) };
  },
});

export const adjustSet = defineCommand({
  id: 'adjust.set',
  summary:
    'Changes a node\'s params as its controls in the Adjustments panel do: params left out keep their values, and each changed param is one "Edit <Node>" history step, as changing those controls one after another is (a param already at the value adds none). Ranges are the controls\': e.g. exposure -5 to 5, contrast -100 to 100, hue -180 to 180. Curves take { rgb?, r?, g?, b? } point lists [{x,y}] in 0-1; levels take { rgb?, r?, g?, b? } partial channels { inputBlack, inputWhite, gamma 0.1-10, outputBlack, outputWhite } in 0-1; colour grading wheels take partial { hue 0-360, saturation 0-100, luminance -100-100 }; gradient map stops are [{ position 0-1, color hex }]; the photo filter colour is "#rrggbb". An unknown param\'s error lists the node type\'s params. Returns the group\'s adjustments.',
  surface: 'document',
  params: {
    group: groupSpec,
    node: nodeSpec,
    params: { type: 'record', description: 'Param names and values for the node\'s type, in the store\'s shape; adjust.list shows them.' },
  },
  run({ group: ref, node: nodeRef, params }): AdjustmentsResult {
    const group = resolveGroup(ref);
    const node = resolveNode(group, nodeRef);
    const label = `Edit ${ADJUSTMENT_NODE_LABELS[node.type]}`;
    for (const [name, value] of checkNodeParams(node, params)) {
      const before = (resolveNode(currentGroup(group.id), node.id) as unknown as Record<string, unknown>)[name];
      if (JSON.stringify(before) === JSON.stringify(value)) continue;
      store().pushHistoryMetadata(label);
      store().updateAdjustmentNode(group.id, node.id, { [name]: value } as Partial<AdjustmentNode>);
    }
    return adjustments(group.id);
  },
});

export const adjustRemove = defineCommand({
  id: 'adjust.remove',
  summary: 'Removes a node from a group, as its Remove node button in the Adjustments panel does ("Remove Adjustment"). Returns the group\'s adjustments.',
  surface: 'document',
  params: { group: groupSpec, node: nodeSpec },
  run({ group: ref, node: nodeRef }): AdjustmentsResult {
    const group = resolveGroup(ref);
    const node = resolveNode(group, nodeRef);
    store().removeAdjustmentNode(group.id, node.id);
    return adjustments(group.id);
  },
});

export const adjustSetNodeEnabled = defineCommand({
  id: 'adjust.set-node-enabled',
  summary:
    'Turns one node on or off, as its eye button in the Adjustments panel does ("Toggle Adjustment"); a node already in that state is left alone with no history step. Returns the group\'s adjustments.',
  surface: 'document',
  params: { group: groupSpec, node: nodeSpec, enabled: { type: 'boolean' } },
  run({ group: ref, node: nodeRef, enabled }): AdjustmentsResult {
    const group = resolveGroup(ref);
    const node = resolveNode(group, nodeRef);
    if (node.enabled !== enabled) store().toggleAdjustmentNode(group.id, node.id);
    return adjustments(group.id);
  },
});

function checkOrder(group: GroupLayer, ids: readonly string[]): void {
  const current = group.adjustments.map((node) => node.id);
  const isPermutation = ids.length === current.length && new Set(ids).size === ids.length && ids.every((id) => current.includes(id));
  if (!isPermutation) {
    throw new CommandError('invalid', `adjust.reorder: nodes must list each of "${group.name}"'s ${current.length} node ids exactly once: ${current.join(', ')}`);
  }
}

export const adjustReorder = defineCommand({
  id: 'adjust.reorder',
  summary:
    'Puts a group\'s nodes in a new order, as dragging a node in the Adjustments panel does ("Reorder Adjustments"); the order applied is top first. The current order is left alone with no history step. Returns the group\'s adjustments.',
  surface: 'document',
  params: {
    group: groupSpec,
    nodes: { type: 'array', items: { type: 'string' }, description: 'Every node id of the group, once each, in the new order.' },
  },
  run({ group: ref, nodes }): AdjustmentsResult {
    const group = resolveGroup(ref);
    checkOrder(group, nodes);
    const isSame = nodes.every((id, i) => group.adjustments[i]?.id === id);
    if (!isSame) store().reorderAdjustmentNodes(group.id, nodes);
    return adjustments(group.id);
  },
});

export const adjustSetEnabled = defineCommand({
  id: 'adjust.set-enabled',
  summary:
    'Turns all of a group\'s adjustments on or off, as the eye button at the foot of the Adjustments panel does; like that button it adds no history step. Returns the group\'s adjustments.',
  surface: 'document',
  params: { group: groupSpec, enabled: { type: 'boolean' } },
  run({ group: ref, enabled }): AdjustmentsResult {
    const group = resolveGroup(ref);
    if ((group.adjustmentsEnabled ?? true) !== enabled) store().setGroupAdjustmentsEnabled(group.id, enabled);
    return adjustments(group.id);
  },
});
