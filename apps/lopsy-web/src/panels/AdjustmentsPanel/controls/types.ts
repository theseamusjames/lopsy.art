import type { AdjustmentNode } from '../../../types/adjustment-nodes';

export interface NodeControlProps<T extends AdjustmentNode = AdjustmentNode> {
  node: T;
  onChange: (params: Partial<AdjustmentNode>) => void;
}
