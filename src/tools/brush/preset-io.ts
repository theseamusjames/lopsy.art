import type { BrushPreset, BrushTipData, SubBrush } from '../../types/brush';

interface SerializedTip {
  width: number;
  height: number;
  data: string;
  kind?: 'alpha' | 'color';
}

interface SerializedSubBrush {
  tip: SerializedTip | null;
  sizeRatio: number;
  hardness: number;
  opacityRatio: number;
  angleOffset: number;
  sizeJitter: number;
  angleJitter: number;
  opacityJitter: number;
}

interface SerializedPreset {
  name: string;
  tip: SerializedTip | null;
  size: number;
  hardness: number;
  spacing: number;
  scatter: number;
  angle: number;
  opacity: number;
  flow: number;
  sizeJitter?: number;
  hardnessJitter?: number;
  angleJitter?: number;
  opacityJitter?: number;
  speedSize?: number;
  speedSizeInvert?: boolean;
  speedSensitivity?: 'low' | 'med' | 'high';
  fade?: number;
  taper?: number;
  subBrushes?: SerializedSubBrush[];
}

function tipToJson(tip: BrushTipData): SerializedTip {
  let binary = '';
  for (let i = 0; i < tip.data.length; i++) {
    binary += String.fromCharCode(tip.data[i]!);
  }
  const s: SerializedTip = { width: tip.width, height: tip.height, data: btoa(binary) };
  if (tip.kind === 'color') s.kind = 'color';
  return s;
}

function tipFromJson(s: SerializedTip): BrushTipData {
  const binary = atob(s.data);
  const data = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) {
    data[i] = binary.charCodeAt(i);
  }
  const tip: BrushTipData = { width: s.width, height: s.height, data };
  if (s.kind === 'color') return { ...tip, kind: 'color' };
  return tip;
}

function subBrushToJson(sub: SubBrush): SerializedSubBrush {
  return {
    tip: sub.tip ? tipToJson(sub.tip) : null,
    sizeRatio: sub.sizeRatio,
    hardness: sub.hardness,
    opacityRatio: sub.opacityRatio,
    angleOffset: sub.angleOffset,
    sizeJitter: sub.sizeJitter,
    angleJitter: sub.angleJitter,
    opacityJitter: sub.opacityJitter,
  };
}

function subBrushFromJson(s: SerializedSubBrush): SubBrush {
  return {
    tip: s.tip ? tipFromJson(s.tip) : null,
    sizeRatio: s.sizeRatio,
    hardness: s.hardness,
    opacityRatio: s.opacityRatio,
    angleOffset: s.angleOffset,
    sizeJitter: s.sizeJitter,
    angleJitter: s.angleJitter,
    opacityJitter: s.opacityJitter,
  };
}

let nextImportId = 1;

export function exportPresets(presets: readonly BrushPreset[]): void {
  if (presets.length === 0) return;
  const customs = presets;

  const serialized: SerializedPreset[] = customs.map((p) => ({
    name: p.name,
    tip: p.tip ? tipToJson(p.tip) : null,
    size: p.size,
    hardness: p.hardness,
    spacing: p.spacing,
    scatter: p.scatter,
    angle: p.angle,
    opacity: p.opacity,
    flow: p.flow,
    sizeJitter: p.sizeJitter,
    hardnessJitter: p.hardnessJitter,
    angleJitter: p.angleJitter,
    opacityJitter: p.opacityJitter,
    speedSize: p.speedSize,
    speedSizeInvert: p.speedSizeInvert,
    speedSensitivity: p.speedSensitivity,
    fade: p.fade,
    taper: p.taper,
    subBrushes: p.subBrushes?.map(subBrushToJson),
  }));

  const json = JSON.stringify({ version: 1, presets: serialized }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lopsy-brushes.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function importPresetsFromFile(
  file: File,
  onAddPresets: (presets: BrushPreset[]) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as { version: number; presets: SerializedPreset[] };
        const presets: BrushPreset[] = parsed.presets.map((s) => ({
          id: `imported-${nextImportId++}`,
          name: s.name,
          tip: s.tip ? tipFromJson(s.tip) : null,
          size: s.size,
          hardness: s.hardness,
          spacing: s.spacing,
          scatter: s.scatter,
          angle: s.angle,
          opacity: s.opacity,
          flow: s.flow,
          isCustom: true,
          sizeJitter: s.sizeJitter,
          hardnessJitter: s.hardnessJitter,
          angleJitter: s.angleJitter,
          opacityJitter: s.opacityJitter,
          speedSize: s.speedSize,
          speedSizeInvert: s.speedSizeInvert,
          speedSensitivity: s.speedSensitivity,
          fade: s.fade,
          taper: s.taper,
          subBrushes: s.subBrushes?.map(subBrushFromJson),
        }));
        onAddPresets(presets);
        resolve(presets.length);
      } catch {
        resolve(0);
      }
    };
    reader.readAsText(file);
  });
}
