import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE, IDENTITY_CURVE, recipeFromPaths, recipeToPaths } from '../library/recipe';
import type { Asset, Version } from '../library/types';
import { curveFromCrs, kelvinForTemperature, temperatureForKelvin, type KelvinScale } from './crs-mapping';
import { readXmp, recipeFromXmp } from './read';
import { writeXmp } from './write';

/** A Lightroom Classic sidecar for a RAW file, with most of the Develop panels in use (synthesized). */
const FULL_LIGHTROOM_XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:Version="16.0" crs:ProcessVersion="11.0"
   crs:WhiteBalance="Custom" crs:Temperature="6500" crs:Tint="-15"
   crs:Exposure2012="-0.35" crs:Contrast2012="+20" crs:Highlights2012="-60" crs:Shadows2012="+45"
   crs:Whites2012="+10" crs:Blacks2012="-15" crs:Vibrance="+25" crs:Saturation="-10"
   crs:Clarity2012="+18" crs:Texture="+12" crs:Dehaze="+8"
   crs:Sharpness="40" crs:SharpenRadius="+1.0" crs:SharpenEdgeMasking="20"
   crs:LuminanceSmoothing="15" crs:ColorNoiseReduction="25" crs:LuminanceNoiseReductionDetail="50"
   crs:HueAdjustmentRed="+5" crs:HueAdjustmentAqua="-20" crs:HueAdjustmentMagenta="0"
   crs:SaturationAdjustmentOrange="-12" crs:SaturationAdjustmentBlue="+30"
   crs:LuminanceAdjustmentYellow="+7" crs:LuminanceAdjustmentPurple="-40"
   crs:ColorGradeShadowHue="220" crs:ColorGradeShadowSat="18" crs:ColorGradeShadowLum="-5"
   crs:ColorGradeMidtoneHue="40" crs:ColorGradeMidtoneSat="6" crs:ColorGradeMidtoneLum="0"
   crs:ColorGradeHighlightHue="45" crs:ColorGradeHighlightSat="22" crs:ColorGradeHighlightLum="+3"
   crs:ColorGradeGlobalHue="0" crs:ColorGradeGlobalSat="0" crs:ColorGradeGlobalLum="0"
   crs:ColorGradeBlending="60" crs:ColorGradeBalance="-20"
   crs:PostCropVignetteAmount="-25" crs:PostCropVignetteMidpoint="40" crs:PostCropVignetteRoundness="-10" crs:PostCropVignetteFeather="70"
   crs:GrainAmount="30" crs:GrainSize="35" crs:GrainFrequency="60"
   crs:HasCrop="True" crs:CropTop="0.05" crs:CropLeft="0.04" crs:CropBottom="0.95" crs:CropRight="0.96" crs:CropAngle="-2.5"
   crs:HasSettings="True">
   <crs:ToneCurvePV2012><rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>64, 52</rdf:li><rdf:li>192, 205</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012>
   <crs:ToneCurvePV2012Red><rdf:Seq><rdf:li>0, 0</rdf:li><rdf:li>255, 255</rdf:li></rdf:Seq></crs:ToneCurvePV2012Red>
   <crs:ToneCurvePV2012Blue><rdf:Seq><rdf:li>0, 20</rdf:li><rdf:li>255, 240</rdf:li></rdf:Seq></crs:ToneCurvePV2012Blue>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

/** A body shot at 5000 K whose temperature +100 is 20000 K and -100 is about 2857 K (made up, the engine's shape). */
const SCALE: KelvinScale = { asShotKelvin: 5000, miredAtZero: 200, miredPerUnit: -1.5 };

describe('Lightroom edit mapping', () => {
  it('maps a full Lightroom sidecar onto the recipe', () => {
    const x = readXmp(FULL_LIGHTROOM_XMP, { kelvinScale: SCALE });
    const r = x ? recipeFromXmp(x, 1) : null;
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.tone).toEqual({ exposure: -0.35, contrast: 20, highlights: -60, shadows: 45, whites: 10, blacks: -15 });
    expect(r.color).toEqual({ vibrance: 25, saturation: -10 });
    // 6500 K on this body: (1e6/6500 - 200) / -1.5.
    expect(r.whiteBalance).toEqual({ mode: 'custom', temperature: 30.77, tint: -10 });
    expect(r.localContrast).toEqual({ large: 18, small: 12, haze: 8 });
    expect(r.sharpness).toEqual({ amount: 40, radius: 1, edges: 20 });
    expect(r.noise).toEqual({ luminance: 15, color: 25, detail: 50 });
    expect(r.colorByHue.red.hue).toBe(5);
    expect(r.colorByHue.aqua.hue).toBe(-20);
    expect(r.colorByHue.orange.saturation).toBe(-12);
    expect(r.colorByHue.blue.saturation).toBe(30);
    expect(r.colorByHue.yellow.luminance).toBe(7);
    expect(r.colorByHue.purple.luminance).toBe(-40);
    expect(r.colorGrading).toEqual({
      shadows: { hue: 220, saturation: 18, luminance: -5 },
      midtones: { hue: 40, saturation: 6, luminance: 0 },
      highlights: { hue: 45, saturation: 22, luminance: 3 },
      global: { hue: 0, saturation: 0, luminance: 0 },
      blending: 60,
      balance: -20,
    });
    expect(r.finish).toEqual({
      vignette: 25,
      vignetteSize: 40,
      vignetteRoundness: -10,
      vignetteFeather: 70,
      grain: { amount: 30, size: 35, roughness: 60 },
    });
    expect(r.curves.luminance).toEqual([
      { x: 0, y: 0 },
      { x: 64 / 255, y: 52 / 255 },
      { x: 192 / 255, y: 205 / 255 },
      { x: 1, y: 1 },
    ]);
    expect(r.curves.red).toBe(IDENTITY_CURVE);
    expect(r.curves.green).toBe(IDENTITY_CURVE);
    expect(r.curves.blue).toEqual([
      { x: 0, y: 20 / 255 },
      { x: 1, y: 240 / 255 },
    ]);
    // A turned crop: the angle maps, the rectangle does not.
    expect(r.framing.angle).toBe(-2.5);
    expect(r.framing.crop).toBeNull();
  });

  it('keeps As Shot white balance, reads relative temperature on JPEGs and clamps out-of-range values', () => {
    const doc = (attrs: string) =>
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" ${attrs}/></rdf:RDF></x:xmpmeta>`;
    const asShot = recipeFromXmp(readXmp(doc('crs:WhiteBalance="As Shot" crs:Temperature="4800" crs:Tint="+3" crs:Exposure2012="+1"'))!, 1);
    expect(asShot?.whiteBalance).toEqual(DEFAULT_RECIPE.whiteBalance);
    const jpeg = recipeFromXmp(readXmp(doc('crs:WhiteBalance="Custom" crs:Temperature="-12" crs:Tint="+9"'))!, 1);
    expect(jpeg?.whiteBalance).toEqual({ mode: 'custom', temperature: -12, tint: 9 });
    const wild = recipeFromXmp(readXmp(doc('crs:Sharpness="400" crs:ColorGradeShadowHue="359" crs:Temperature="2000" crs:WhiteBalance="Tungsten"'))!, 1);
    expect(wild?.sharpness.amount).toBe(150);
    expect(wild?.colorGrading.shadows.hue).toBe(359);
    // RAW Kelvin without the photo's scale: left as shot.
    expect(wild?.whiteBalance).toEqual(DEFAULT_RECIPE.whiteBalance);
  });

  it('reads the vignette shape and grain only with a vignette or grain', () => {
    const doc = (attrs: string) =>
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" ${attrs}/></rdf:RDF></x:xmpmeta>`;
    const off = recipeFromXmp(
      readXmp(doc('crs:Exposure2012="+1" crs:PostCropVignetteAmount="0" crs:PostCropVignetteMidpoint="50" crs:GrainAmount="0" crs:GrainSize="25"'))!,
      1,
    );
    expect(off?.finish).toEqual(DEFAULT_RECIPE.finish);
  });

  it('reads curves defensively', () => {
    expect(curveFromCrs(['0, 0', '255, 255'])).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(curveFromCrs(['32, 10', '200, 250'])).toEqual([
      { x: 0, y: 10 / 255 },
      { x: 32 / 255, y: 10 / 255 },
      { x: 200 / 255, y: 250 / 255 },
      { x: 1, y: 250 / 255 },
    ]);
    expect(curveFromCrs(['0, 0', '0, 10', '255, 255'])).toBeNull();
    expect(curveFromCrs(['0, 0', 'x, 1', '255, 255'])).toBeNull();
    expect(curveFromCrs(['0, 0', '300, 1'])).toBeNull();
    expect(curveFromCrs(Array.from({ length: 20 }, (_, i) => `${i * 13}, ${i * 13}`))).toBeNull();
    expect(curveFromCrs(undefined)).toBeNull();
  });

  it("converts Kelvin both ways on the photo's own scale", () => {
    expect(temperatureForKelvin(SCALE, 5000)).toBe(0);
    expect(kelvinForTemperature(SCALE, 0)).toBe(5000);
    for (const t of [-90, -30, 0, 25, 80]) expect(temperatureForKelvin(SCALE, kelvinForTemperature(SCALE, t)!)).toBeCloseTo(t, 6);
    expect(temperatureForKelvin(SCALE, 1_000_000)).toBe(100);
  });

  it("maps RAW Kelvin only against the photo's as-shot balance", () => {
    const doc = (attrs: string) =>
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" ${attrs}/></rdf:RDF></x:xmpmeta>`;
    const tungsten = doc('crs:WhiteBalance="Custom" crs:Temperature="3200" crs:Tint="+6" crs:Exposure2012="+0.5"');
    // A frame shot under tungsten, kept at 3200 K in Lightroom: no change from as shot.
    const tungstenScale: KelvinScale = { asShotKelvin: 3200, miredAtZero: 1e6 / 3200, miredPerUnit: -1.5 };
    expect(recipeFromXmp(readXmp(tungsten, { kelvinScale: tungstenScale })!, 1)?.whiteBalance).toEqual({ mode: 'custom', temperature: 0, tint: 4 });
    // Without the scale the white balance is left as shot; the other edits still map.
    const unknown = recipeFromXmp(readXmp(tungsten)!, 1);
    expect(unknown?.whiteBalance).toEqual(DEFAULT_RECIPE.whiteBalance);
    expect(unknown?.tone.exposure).toBe(0.5);

    // Writing: Kelvin on the photo's scale, or As Shot when it is not known; JPEG stays relative.
    const recipe = recipeFromPaths({ 'whiteBalance.mode': 'custom', 'whiteBalance.temperature': 0, 'whiteBalance.tint': 4 });
    const asset = { id: 'a', format: 'raf', rating: 0, setAside: false, label: null, keywords: [], title: null, caption: null } as unknown as Asset;
    const version = { id: 'v', assetId: 'a', name: 'Original', recipe } as unknown as Version;
    const known = writeXmp(asset, version, { kelvinScale: tungstenScale });
    expect(known).toContain('crs:WhiteBalance="Custom"');
    expect(known).toContain('crs:Temperature="3200"');
    expect(known).toContain('crs:Tint="+6"');
    const blind = writeXmp(asset, version);
    expect(blind).toContain('crs:WhiteBalance="As Shot"');
    expect(blind).not.toContain('crs:Temperature=');
    const jpeg = writeXmp({ ...asset, format: 'jpeg' } as Asset, version);
    expect(jpeg).toContain('crs:Temperature="0"');
    expect(jpeg).toContain('crs:Tint="+4"');
  });

  it('writes Camera Raw settings Lightroom reads back to the same recipe', () => {
    const x = readXmp(FULL_LIGHTROOM_XMP, { kelvinScale: SCALE })!;
    const recipe = recipeFromXmp(x, 1)!;
    const asset = { id: 'a', format: 'raf', rating: 0, setAside: false, label: null, keywords: [], title: null, caption: null } as unknown as Asset;
    const version = { id: 'v', assetId: 'a', name: 'Original', recipe } as unknown as Version;
    for (const format of ['raf', 'jpeg'] as const) {
      const text = writeXmp({ ...asset, format }, version, { kelvinScale: SCALE });
      // Drop our own namespace, so only the crs: mapping is read back.
      const crsOnly = text.replace(/\s+lpp:[^=\s]+="[^"]*"/g, '');
      const back = readXmp(crsOnly, { kelvinScale: SCALE })!;
      expect(back.recipe).toBeNull();
      const read = recipeFromXmp(back, 1)!;
      const expected = recipeToPaths(recipe);
      const got = recipeToPaths(read);
      for (const path of Object.keys(expected)) {
        // The turned crop's angle is not written (see write.ts); white balance goes through Kelvin on RAW.
        if (path === 'framing.angle') continue;
        if (typeof expected[path] === 'number') expect(got[path] as number, `${format} ${path}`).toBeCloseTo(expected[path] as number, 1);
        else if (Array.isArray(expected[path])) {
          (expected[path] as { x: number; y: number }[]).forEach((p, i) => {
            const q = (got[path] as { x: number; y: number }[])[i]!;
            expect(q.x).toBeCloseTo(p.x, 2);
            expect(q.y).toBeCloseTo(p.y, 2);
          });
        } else expect(got[path], `${format} ${path}`).toEqual(expected[path]);
      }
    }
  });

  it('writes no sharpening explicitly, so Lightroom does not add its own', () => {
    const recipe = recipeFromPaths({ 'tone.exposure': 1 });
    const asset = { id: 'a', format: 'raf', rating: 0, setAside: false, label: null, keywords: [], title: null, caption: null } as unknown as Asset;
    const text = writeXmp(asset, { id: 'v', assetId: 'a', name: 'Original', recipe } as unknown as Version);
    expect(text).toContain('crs:Sharpness="0"');
    expect(text).toContain('crs:ColorNoiseReduction="0"');
  });
});
