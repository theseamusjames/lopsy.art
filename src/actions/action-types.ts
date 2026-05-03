export type ActionStep =
  | { type: 'filter'; filter: string; params: Record<string, unknown> }
  | { type: 'adjustment'; adjustment: string; params: Record<string, unknown> }
  | { type: 'selection'; operation: string; params: Record<string, unknown> }
  | { type: 'layer'; operation: string; params: Record<string, unknown> };

export interface Action {
  id: string;
  name: string;
  steps: ActionStep[];
}
