/**
 * Writes an XMP sidecar for an asset: rating, label, keywords, title and
 * caption in the standard namespaces; the basic edits as Camera Raw
 * settings (the same approximate mapping as read.ts, the other way); and
 * the full recipe in our namespace, which reads back exactly.
 */

import { DEFAULT_RECIPE, recipeToPaths } from '../library/recipe';
import type { Recipe } from '../library/recipe';
import type { Asset, ColorLabel, Version } from '../library/types';
import { CRS_MAPPING, NS } from './read';

const LABEL_NAMES: Readonly<Record<ColorLabel, string>> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
};

/** Escapes text for an attribute value or element content, dropping characters XML cannot hold. */
export function escapeXml(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    if (code === 0xfffe || code === 0xffff || (code >= 0xd800 && code <= 0xdfff)) continue;
    switch (ch) {
      case '&':
        out += '&amp;';
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '"':
        out += '&quot;';
        break;
      case '\n':
        out += '&#10;';
        break;
      case '\r':
        out += '&#13;';
        break;
      case '\t':
        out += '&#9;';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

function crsAttributes(recipe: Recipe): string[] {
  const paths = recipeToPaths(recipe);
  const defaults = recipeToPaths(DEFAULT_RECIPE);
  const out: string[] = [];
  for (const { crs, path } of CRS_MAPPING) {
    const value = paths[path];
    if (typeof value === 'number' && value !== defaults[path]) out.push(`crs:${crs}="${value > 0 ? '+' : ''}${value}"`);
  }
  const crop = recipe.framing.crop;
  if (crop && recipe.framing.rotate === 0 && !recipe.framing.flipH && !recipe.framing.flipV && recipe.framing.angle === 0) {
    out.push(
      `crs:HasCrop="True"`,
      `crs:CropLeft="${crop.x}"`,
      `crs:CropTop="${crop.y}"`,
      `crs:CropRight="${crop.x + crop.width}"`,
      `crs:CropBottom="${crop.y + crop.height}"`,
      `crs:CropAngle="0"`,
    );
  }
  if (out.length > 0) out.unshift('crs:HasSettings="True"', 'crs:ProcessVersion="11.0"');
  return out;
}

function altElement(qname: string, value: string): string {
  return `   <${qname}><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(value)}</rdf:li></rdf:Alt></${qname}>`;
}

/** The sidecar text for `asset`, with `version`'s recipe (the primary version, usually). */
export function writeXmp(asset: Asset, version: Version | null): string {
  const attributes: string[] = ['rdf:about=""'];
  attributes.push(`xmp:Rating="${asset.setAside ? -1 : asset.rating}"`);
  if (asset.label) attributes.push(`xmp:Label="${LABEL_NAMES[asset.label]}"`);
  if (version) {
    attributes.push(...crsAttributes(version.recipe));
    const paths = recipeToPaths(version.recipe);
    for (const key of Object.keys(paths).sort()) {
      attributes.push(`lpp:${key}="${escapeXml(JSON.stringify(paths[key]))}"`);
    }
  }
  const children: string[] = [];
  if (asset.keywords.length > 0) {
    children.push(
      '   <dc:subject><rdf:Bag>',
      ...asset.keywords.map((k) => `     <rdf:li>${escapeXml(k)}</rdf:li>`),
      '   </rdf:Bag></dc:subject>',
    );
  }
  if (asset.title) children.push(altElement('dc:title', asset.title));
  if (asset.caption) children.push(altElement('dc:description', asset.caption));
  const namespaces = [
    `xmlns:xmp="${NS.xmp}"`,
    `xmlns:dc="${NS.dc}"`,
    `xmlns:crs="${NS.crs}"`,
    `xmlns:lpp="${NS.lopsy}"`,
  ];
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Lopsy Photos">',
    ` <rdf:RDF xmlns:rdf="${NS.rdf}">`,
    `  <rdf:Description ${[...namespaces, ...attributes].join('\n    ')}>`,
    ...children,
    '  </rdf:Description>',
    ' </rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
    '',
  ].join('\n');
}
