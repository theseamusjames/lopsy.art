import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type CSSProperties } from 'react';
import { DEFAULT_RECIPE, addArea, duplicateArea, removeArea, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import { applyChanges, sliderChanges } from '../edit-controls';
import { MaskPanel } from './MaskPanel';

const meta: Meta<typeof MaskPanel> = {
  component: MaskPanel,
};

export default meta;
type Story = StoryObj<typeof MaskPanel>;

function withMasks(): Recipe {
  const sky = addArea(DEFAULT_RECIPE, 'linear', 'm1', 'Sky');
  const one = applyChanges(DEFAULT_RECIPE, {
    ...(sky?.values ?? {}),
    'areas.m1.adjustments.exposure': -0.8,
    'areas.m1.adjustments.temperature': -20,
    // A colour grade of its own: the sky's shadows towards blue.
    'areas.m1.fx.colorGrading.shadows.hue': 220,
    'areas.m1.fx.colorGrading.shadows.saturation': 45,
    // And a little more local contrast there.
    'areas.m1.fx.localContrast.large': 30,
  });
  const face = addArea(one, 'radial', 'm2');
  return applyChanges(one, face?.values ?? {});
}

/** The panel over a recipe kept here, as the Edit view keeps it: every button does what it does there. */
function Controlled({ initial }: { readonly initial: Recipe }) {
  const [recipe, setRecipe] = useState(initial);
  const [selectedId, setSelectedId] = useState<string | null>('m1');
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [count, setCount] = useState(3);
  const change = (changes: Readonly<Record<string, Json>>) => setRecipe((r) => applyChanges(r, changes));
  const nextId = () => {
    setCount((n) => n + 1);
    return `m${count}`;
  };
  return (
    <div style={{ '--slider-label-width': '72px', '--slider-value-width': '56px' } as CSSProperties}>
      <MaskPanel
        recipe={recipe}
        selectedId={selectedId}
        isDisabled={false}
        onAdd={(kind) => {
          const id = nextId();
          change(addArea(recipe, kind, id)?.values ?? {});
          setSelectedId(id);
        }}
        onDuplicate={(sourceId) => {
          const id = nextId();
          change(duplicateArea(recipe, sourceId, id)?.values ?? {});
          setSelectedId(id);
        }}
        onSelect={setSelectedId}
        onRename={(id, name) => change({ [`areas.${id}.name`]: name })}
        onInvert={(id, isInverted) => change({ [`areas.${id}.invert`]: isInverted })}
        onDelete={(id) => change(removeArea(id))}
        onChange={(control, value) => change(sliderChanges(control.path, value))}
        onCommit={(control, value) => change(sliderChanges(control.path, value))}
        onDraftChanges={change}
        onCommitChanges={change}
        hiddenIds={hidden}
        onToggleHidden={(id) =>
          setHidden((prev) => {
            const next = new Set(prev);
            if (!next.delete(id)) next.add(id);
            return next;
          })
        }
        isHideDisabled={false}
      />
    </div>
  );
}

export const TwoMasks: Story = {
  render: () => <Controlled initial={withMasks()} />,
};

export const NoMasks: Story = {
  render: () => <Controlled initial={DEFAULT_RECIPE} />,
};
