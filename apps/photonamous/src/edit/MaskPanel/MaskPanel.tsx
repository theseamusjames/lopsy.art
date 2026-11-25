import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Circle, Copy, Pencil, Plus, Rows2, Trash2, X } from 'lucide-react';
import { useMenuKeys } from '@lopsy/ui/a11y/use-menu-keys';
import { Menu, MenuItem } from '@lopsy/ui/Menu';
import { MAX_AREAS, liveAreas, type Area, type AreaKind, type LinearGeometry, type RadialGeometry, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import type { AreaFrame } from '../../engine/areas';
import { AREA_SLIDERS, areaLabel, isAreaInUse } from '../area-edit';
import { formatShape, parseShape, shapeControls, shapeValue, withShapeValue, type AreaShapeControl, type DocSize, type ShapeUnit } from '../area-shape';
import { areaEffectResetChanges, areaExtras, defaultAt, numberAt, rangeOf, type AreaExtraDef, type ControlDef } from '../edit-controls';
import { CurvesControls } from '../CurvesControls/CurvesControls';
import { EditSection } from '../EditSection/EditSection';
import { EditSlider, type SliderReadout } from '../EditSlider/EditSlider';
import { TabbedControls } from '../TabbedControls/TabbedControls';
import { placeMenu, type MenuPlace } from './menu-place';
import styles from './MaskPanel.module.css';

export interface MaskPanelProps {
  /** The recipe the sliders show, a drag in progress included. */
  readonly recipe: Recipe;
  /** The open mask, whose handles are on the photo; null when every one is folded. */
  readonly selectedId: string | null;
  readonly isDisabled: boolean;
  readonly onAdd: (kind: AreaKind) => void;
  readonly onDuplicate: (areaId: string) => void;
  readonly onSelect: (areaId: string | null) => void;
  readonly onRename: (areaId: string, name: string) => void;
  readonly onInvert: (areaId: string, isInverted: boolean) => void;
  readonly onDelete: (areaId: string) => void;
  readonly onChange: (control: ControlDef, value: number) => void;
  readonly onCommit: (control: ControlDef, value: number) => void;
  /** Values by path while something is dragged that is not one slider: a colour field, a curve's point. */
  readonly onDraftChanges: (changes: Record<string, Json>) => void;
  /** Values by path as one step: those let go, or a further adjustment taken off the mask. */
  readonly onCommitChanges: (changes: Record<string, Json>, label: string) => void;
  /** The masks whose eye is off: the photo is shown without them. */
  readonly hiddenIds: ReadonlySet<string>;
  readonly onToggleHidden: (areaId: string) => void;
  /** The eyes can't be pressed now (the photo is loading, or Before is on). */
  readonly isHideDisabled: boolean;
  /** Where the photo is, for the open mask's shape sliders; they show once it is known. */
  readonly shapeFrame?: { readonly frame: AreaFrame; readonly doc: DocSize } | null;
  /** While a shape slider moves. */
  readonly onShapeChange?: (areaId: string, geometry: LinearGeometry | RadialGeometry) => void;
  /** Once, when it is let go. */
  readonly onShapeCommit?: (areaId: string, geometry: LinearGeometry | RadialGeometry, label: string) => void;
}

/** Where focus goes once the panel has rendered again. */
type FocusTarget =
  | { readonly kind: 'area'; readonly id: string }
  | { readonly kind: 'new' }
  | { readonly kind: 'extra'; readonly id: string; readonly key: string }
  | { readonly kind: 'addAdjustment'; readonly id: string };

const NONE: ReadonlySet<string> = new Set();

const READOUTS: Readonly<Record<ShapeUnit, SliderReadout>> = {
  percent: { format: (v) => formatShape(v, 'percent'), parse: parseShape },
  degrees: { format: (v) => formatShape(v, 'degrees'), parse: parseShape },
};

interface MenuChoice {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly icon?: ReactNode;
  readonly onSelect: () => void;
}

interface MenuButtonProps {
  /** The menu's name. */
  readonly label: string;
  /** The button's name, when its content is an icon. */
  readonly ariaLabel?: string;
  readonly title?: string;
  readonly className: string | undefined;
  readonly isDisabled: boolean;
  readonly choices: readonly MenuChoice[];
  readonly buttonData?: Readonly<Record<`data-${string}`, string>>;
  readonly children: ReactNode;
}

/** A row of the menu, with its padding and gap, to tell whether the menu fits under its button. */
const CHOICE_HEIGHT = 36;
const DETAIL_HEIGHT = 18;

/** A button that opens a menu of choices, placed in the window (menu-place.ts). */
function MenuButton({ label, ariaLabel, title, className, isDisabled, choices, buttonData, children }: MenuButtonProps) {
  const [place, setPlace] = useState<MenuPlace | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => setPlace(null);
  const open = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const wanted = 16 + choices.reduce((sum, c) => sum + CHOICE_HEIGHT + (c.detail ? DETAIL_HEIGHT : 0), 0);
    setPlace(placeMenu(rect, window.innerHeight, wanted));
  };
  const keys = useMenuKeys({ isOpen: place !== null, onClose: close, onOpen: open, triggerRef });
  const isOpen = place !== null;

  // The menu is placed in the window: when the panel scrolls under it, or the window changes, it closes.
  useEffect(() => {
    if (!isOpen) return;
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && keys.menuRef.current?.contains(e.target)) return;
      setPlace(null);
    };
    const onResize = () => setPlace(null);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen, keys.menuRef]);

  const vars = place
    ? ({
        '--menu-left': `${place.left}px`,
        '--menu-top': place.top === null ? 'auto' : `${place.top}px`,
        '--menu-bottom': place.bottom === null ? 'auto' : `${place.bottom}px`,
        '--menu-max-height': `${place.maxHeight}px`,
      } as CSSProperties)
    : undefined;

  return (
    <span className={styles.menuWrap} style={vars}>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        aria-label={ariaLabel}
        title={title}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={isDisabled}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={keys.onTriggerKeyDown}
        {...buttonData}
      >
        {children}
      </button>
      {isOpen && (
        <Menu keys={keys} label={label} className={styles.popup}>
          {choices.map((choice) => (
            <MenuItem
              key={choice.key}
              icon={choice.icon}
              detail={choice.detail}
              onSelect={() => {
                close();
                choice.onSelect();
              }}
            >
              {choice.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </span>
  );
}

/**
 * The Mask panel (spec 5.4; a mask is an area in the recipe and the
 * engine). Each mask is a section, as the Edit panel's are: its name, a
 * pencil to rename it, Delete and its eye, folded until it is opened. The
 * open one is the selected one, whose handles are on the photo; one is open
 * at a time. Inside: Invert, Amount and the mask's own Exposure, Contrast,
 * Highlights, Shadows, Temperature, Tint and Saturation, then the shape
 * sliders under a closed Position (the keyboard's way to do what dragging
 * the handles does: WCAG 2.1.1, 2.5.7), and at the bottom Add adjustment,
 * as Lopsy's adjustments have: it gives the mask a further adjustment of
 * its own, any of the Edit panel's other sections (`areaExtras`), drawn as
 * the mask's layer over the photo's edits, and each has a button that takes
 * it off again. One the mask is using shows when the panel opens. The bar at the panel's foot stays
 * in place: New mask, Duplicate. With no mask yet, the middle of the panel
 * has one button, Add a mask. The open mask shows in red for a moment when
 * it is opened or its eye is turned back on; O keeps it shown.
 */
export function MaskPanel({
  recipe,
  selectedId,
  isDisabled,
  onAdd,
  onDuplicate,
  onSelect,
  onRename,
  onInvert,
  onDelete,
  onChange,
  onCommit,
  onDraftChanges,
  onCommitChanges,
  hiddenIds,
  onToggleHidden,
  isHideDisabled,
  shapeFrame,
  onShapeChange,
  onShapeCommit,
}: MaskPanelProps) {
  const areas = liveAreas(recipe);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [focusAfter, setFocusAfter] = useState<FocusTarget | null>(null);
  const [isPositionOpen, setIsPositionOpen] = useState(false);
  // The further adjustments each mask shows, once shown: added here, or found doing something.
  const [kept, setKept] = useState<Readonly<Record<string, ReadonlySet<string>>>>({});
  const positionId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const isFull = areas.length >= MAX_AREAS;
  const selectedIndex = areas.findIndex((a) => a.id === selectedId);
  const selected = areas[selectedIndex];

  // One that is showing stays while it is taken back to neutral, and after an undo that does so.
  const recipeAreas = recipe.areas;
  useEffect(() => {
    setKept((prev) => {
      let next = prev;
      for (const area of Object.values(recipeAreas ?? {})) {
        const has = prev[area.id];
        const found = areaExtras(area.id, '')
          .filter((extra) => !has?.has(extra.key) && Object.keys(areaEffectResetChanges(recipe, extra.paths)).length > 0)
          .map((extra) => extra.key);
        if (found.length === 0) continue;
        if (next === prev) next = { ...prev };
        (next as Record<string, ReadonlySet<string>>)[area.id] = new Set([...(has ?? []), ...found]);
      }
      return next;
    });
    // Only the areas matter here, and `recipe` is read for them alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeAreas]);

  useEffect(() => {
    if (!focusAfter) return;
    const panel = panelRef.current;
    // An area's ID is letters, digits, _ and - (recipe.ts), so it goes in a quoted selector as it is.
    const section = 'id' in focusAfter ? panel?.querySelector<HTMLElement>(`[data-mask="${focusAfter.id}"]`) : null;
    const target =
      focusAfter.kind === 'new'
        ? panel?.querySelector<HTMLElement>('[data-area-add]')
        : focusAfter.kind === 'area'
          ? section?.querySelector<HTMLElement>('[data-area-id]')
          : focusAfter.kind === 'extra'
            ? section?.querySelector<HTMLElement>(`[data-extra="${focusAfter.key}"] :is([role="tab"][aria-selected="true"], input[type="range"])`)
            : section?.querySelector<HTMLElement>('[data-add-adjustment]');
    target?.focus();
    setFocusAfter(null);
  }, [focusAfter]);

  const finishRename = (area: Area, name: string | null) => {
    if (name !== null) onRename(area.id, name.trim());
    setRenaming(null);
    setFocusAfter({ kind: 'area', id: area.id });
  };

  const handleDelete = (index: number) => {
    const area = areas[index];
    if (!area) return;
    const neighbour = areas[index + 1] ?? areas[index - 1];
    onDelete(area.id);
    setFocusAfter(neighbour ? { kind: 'area', id: neighbour.id } : { kind: 'new' });
  };

  const keep = (areaId: string, key: string, isKept: boolean) =>
    setKept((prev) => {
      const next = new Set(prev[areaId] ?? []);
      if (isKept) next.add(key);
      else next.delete(key);
      return { ...prev, [areaId]: next };
    });

  const handleAddExtra = (area: Area, extra: AreaExtraDef) => {
    keep(area.id, extra.key, true);
    setFocusAfter({ kind: 'extra', id: area.id, key: extra.key });
  };

  /** One of a mask's further adjustments: its name with the button that takes it off, then its controls. */
  const extraBlock = (area: Area, label: string, extra: AreaExtraDef, isOff: boolean) => {
    const reset = areaEffectResetChanges(recipe, extra.paths);
    return (
      <div key={extra.key} className={styles.extra} role="group" aria-label={`${label} ${extra.label.toLowerCase()}`} data-extra={extra.key}>
        <div className={styles.extraHeader}>
          <h3 className={styles.extraTitle}>{extra.label}</h3>
          <button
            type="button"
            className={styles.icon}
            aria-label={`Remove ${extra.label}`}
            title={`Remove ${extra.label} from this mask`}
            disabled={isOff}
            onClick={() => {
              keep(area.id, extra.key, false);
              if (Object.keys(reset).length > 0) onCommitChanges(reset, `${label}: remove ${extra.label.toLowerCase()}`);
              setFocusAfter({ kind: 'addAdjustment', id: area.id });
            }}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
        {extra.kind === 'sliders' && extra.controls.map((control) => slider(control, isOff))}
        {extra.kind === 'tabs' && (
          <TabbedControls
            title={`${label} ${extra.label.toLowerCase()}`}
            tabs={extra.tabs}
            sharedControls={extra.shared}
            recipe={recipe}
            isDisabled={isOff}
            onChange={onChange}
            onCommit={onCommit}
            onFieldChange={onDraftChanges}
            onFieldCommit={onCommitChanges}
          />
        )}
        {extra.kind === 'curves' && (
          <CurvesControls
            curves={area.effects.curves}
            pathOf={(channel) => extra.paths.find((path) => path.endsWith(`.curves.${channel}`)) ?? ''}
            historyLabel={(channel) => `${label} curves: ${channel}`}
            isDisabled={isOff}
            onDraft={onDraftChanges}
            onCommit={onCommitChanges}
          />
        )}
      </div>
    );
  };

  const slider = (control: ControlDef, isOff: boolean) => {
    const range = rangeOf(control.path);
    return (
      <EditSlider
        key={control.path}
        label={control.label}
        value={numberAt(recipe, control.path)}
        min={range.min}
        max={range.max}
        step={range.step}
        defaultValue={defaultAt(control.path)}
        disabled={isOff}
        onChange={(v) => onChange(control, v)}
        onCommit={(v) => onCommit(control, v)}
      />
    );
  };

  const shapeSlider = (area: Area, frame: AreaFrame, doc: DocSize, control: AreaShapeControl, isOff: boolean) => (
    <EditSlider
      key={control.key}
      label={control.label}
      value={shapeValue(area, frame, doc, control.key)}
      min={control.min}
      max={control.max}
      step={control.step}
      defaultValue={control.defaultValue}
      disabled={isOff}
      {...READOUTS[control.unit]}
      onChange={(v) => onShapeChange?.(area.id, withShapeValue(area, frame, doc, control.key, v))}
      onCommit={(v) => onShapeCommit?.(area.id, withShapeValue(area, frame, doc, control.key, v), control.historyLabel)}
    />
  );

  const maskSection = (area: Area, index: number) => {
    const label = areaLabel(area, index);
    const isOpen = area.id === selectedId;
    const isHidden = hiddenIds.has(area.id);
    const isOff = isDisabled || isHidden;
    const all = areaExtras(area.id, label);
    const shown = kept[area.id] ?? NONE;
    const extras = all.filter((extra) => shown.has(extra.key) || Object.keys(areaEffectResetChanges(recipe, extra.paths)).length > 0);
    const waiting = all.filter((extra) => !extras.includes(extra));
    return (
      <div key={area.id} data-mask={area.id}>
        <EditSection
          title={label}
          isOpen={isOpen}
          onToggle={() => onSelect(isOpen ? null : area.id)}
          isChanged={isAreaInUse(area)}
          toggleData={{ 'data-area-id': area.id }}
          titleAction={
            <button
              type="button"
              className={styles.icon}
              aria-label={`Rename ${label}`}
              title="Rename"
              disabled={isDisabled}
              onClick={() => setRenaming({ id: area.id, name: area.name })}
            >
              <Pencil size={13} aria-hidden />
            </button>
          }
          titleEditor={
            renaming?.id === area.id ? (
              <form
                className={styles.rename}
                onSubmit={(e) => {
                  e.preventDefault();
                  finishRename(area, renaming.name);
                }}
              >
                <input
                  className={styles.input}
                  aria-label="Mask name"
                  value={renaming.name}
                  placeholder={label}
                  autoFocus
                  maxLength={60}
                  onChange={(e) => setRenaming({ id: area.id, name: e.currentTarget.value })}
                  onBlur={() => setRenaming(null)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Escape') return;
                    e.preventDefault();
                    finishRename(area, null);
                  }}
                />
              </form>
            ) : undefined
          }
          actions={
            <button type="button" className={styles.icon} aria-label={`Delete ${label}`} title="Delete" disabled={isDisabled} onClick={() => handleDelete(index)}>
              <Trash2 size={14} aria-hidden />
            </button>
          }
          hide={{ isHidden, isDisabled: isHideDisabled, onToggle: () => onToggleHidden(area.id) }}
        >
          <div className={styles.kindRow}>
            <span className={styles.kind}>{area.kind === 'linear' ? 'Linear' : 'Radial'}</span>
            <button
              type="button"
              className={styles.button}
              aria-label={`Invert ${label}`}
              aria-pressed={area.invert}
              title="Adjust the rest of the photo instead"
              disabled={isOff}
              onClick={() => onInvert(area.id, !area.invert)}
            >
              Invert
            </button>
          </div>
          <div className={styles.controls} aria-label={`${label} adjustments`} role="group">
            {slider({ path: `areas.${area.id}.amount`, label: 'Amount', historyLabel: `${label} amount` }, isOff)}
            {AREA_SLIDERS.map((s) =>
              slider({ path: `areas.${area.id}.adjustments.${s.key}`, label: s.label, historyLabel: `${label} ${s.label.toLowerCase()}` }, isOff),
            )}
          </div>
          {extras.map((extra) => extraBlock(area, label, extra, isOff))}
          {shapeFrame && (
            <div className={styles.position}>
              <h3 className={styles.subheading}>
                <button
                  type="button"
                  className={styles.disclosure}
                  aria-expanded={isPositionOpen}
                  aria-controls={positionId}
                  onClick={() => setIsPositionOpen((v) => !v)}
                >
                  {isPositionOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  <span>Position</span>
                </button>
              </h3>
              <div id={positionId} className={styles.shape} role="group" aria-label={`${label} position`} hidden={!isPositionOpen}>
                {isPositionOpen && shapeControls(area).map((control) => shapeSlider(area, shapeFrame.frame, shapeFrame.doc, control, isOff))}
              </div>
            </div>
          )}
          {waiting.length > 0 && (
            <div className={styles.addRow}>
              <MenuButton
                label="Adjustments"
                className={styles.addAdjustment}
                isDisabled={isOff}
                buttonData={{ 'data-add-adjustment': '' }}
                choices={waiting.map((extra) => ({ key: extra.key, label: extra.label, onSelect: () => handleAddExtra(area, extra) }))}
              >
                <Plus size={12} aria-hidden />
                <span>Add adjustment</span>
              </MenuButton>
            </div>
          )}
        </EditSection>
      </div>
    );
  };

  const kinds: readonly MenuChoice[] = [
    { key: 'linear', label: 'Linear', detail: 'A gradient across the photo (M)', icon: <Rows2 size={16} aria-hidden />, onSelect: () => onAdd('linear') },
    { key: 'radial', label: 'Radial', detail: 'An ellipse (Shift+M)', icon: <Circle size={16} aria-hidden />, onSelect: () => onAdd('radial') },
  ];

  return (
    <section ref={panelRef} className={styles.panel} aria-label="Mask">
      <div className={styles.masks} data-empty={areas.length === 0 ? true : undefined}>
        {areas.length === 0 && (
          <MenuButton label="New mask" className={styles.addMask} isDisabled={isDisabled} buttonData={{ 'data-area-add': '' }} choices={kinds}>
            <Plus size={14} aria-hidden />
            <span>Add a mask</span>
          </MenuButton>
        )}
        {areas.map(maskSection)}
      </div>
      <div className={styles.foot} role="group" aria-label="Masks">
        <MenuButton
          label="New mask"
          ariaLabel="New mask"
          title={isFull ? `A photo holds ${MAX_AREAS} masks` : 'New mask'}
          className={styles.footButton}
          isDisabled={isDisabled || isFull}
          buttonData={{ 'data-area-add': '' }}
          choices={kinds}
        >
          <Plus size={16} aria-hidden />
        </MenuButton>
        <button
          type="button"
          className={styles.footButton}
          aria-label="Duplicate mask"
          title={selected ? `Duplicate ${areaLabel(selected, selectedIndex)}` : 'Duplicate mask: open one first'}
          disabled={isDisabled || !selected || isFull}
          onClick={() => {
            if (selected) onDuplicate(selected.id);
          }}
        >
          <Copy size={16} aria-hidden />
        </button>
      </div>
    </section>
  );
}
