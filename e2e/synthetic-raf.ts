/**
 * Builds an uncompressed Fujifilm RAF in memory, so RAF import can be tested
 * without the (large, non-redistributable) camera samples. Mirrors
 * engine-rs/crates/lopsy-core/tests/support/synthetic_raf.rs.
 *
 * The scene is a neutral gray ramp: brightness rises steeply with sensor x
 * and gently with sensor y, so the EXIF orientation and any misplaced or
 * missing band are visible in the decoded pixels.
 */

const XTRANS_PATTERN = [
  1, 1, 0, 1, 1, 2,
  1, 1, 2, 1, 1, 0,
  2, 0, 1, 0, 2, 1,
  1, 1, 2, 1, 1, 0,
  1, 1, 0, 1, 1, 2,
  0, 2, 1, 2, 0, 1,
];

const BLACK = 1024;
const CROP_TOP = 6;
const CROP_LEFT = 12;

export interface SyntheticRafOptions {
  width: number;
  height: number;
  /** EXIF orientation, 1–8. */
  orientation: number;
}

/** Sensor brightness (0–1 of the usable range) at a cropped-frame pixel. */
export function syntheticRafLevel(x: number, y: number, width: number, height: number): number {
  return 0.08 + 0.45 * (x / width) + 0.15 * (y / height);
}

export function buildSyntheticRaf({ width, height, orientation }: SyntheticRafOptions): Buffer {
  const rawW = width + CROP_LEFT + 12;
  const rawH = height + CROP_TOP + 4;
  const jpeg = exifJpeg(orientation);
  const cfaHeader = cfaHeaderBlock(width, height);
  const cfaTiff = cfaTiffBlock(rawW, rawH, width, height);

  const jpegOff = 160;
  const cfaHeaderOff = jpegOff + jpeg.length;
  const cfaDataOff = cfaHeaderOff + cfaHeader.length;

  const head = Buffer.alloc(jpegOff);
  head.write('FUJIFILMCCD-RAW ', 0, 'latin1');
  head.write('X-T5', 28, 'latin1');
  head.writeUInt32BE(jpegOff, 84);
  head.writeUInt32BE(jpeg.length, 88);
  head.writeUInt32BE(cfaHeaderOff, 92);
  head.writeUInt32BE(cfaHeader.length, 96);
  head.writeUInt32BE(cfaDataOff, 100);
  head.writeUInt32BE(cfaTiff.length, 104);
  return Buffer.concat([head, jpeg, cfaHeader, cfaTiff]);
}

function cfaHeaderBlock(width: number, height: number): Buffer {
  const b = Buffer.alloc(4 + 8 + 8 + 4 + 36);
  let o = b.writeUInt32BE(3, 0);
  o = b.writeUInt16BE(0x0110, o);
  o = b.writeUInt16BE(4, o);
  o = b.writeUInt16BE(CROP_TOP, o);
  o = b.writeUInt16BE(CROP_LEFT, o);
  o = b.writeUInt16BE(0x0111, o);
  o = b.writeUInt16BE(4, o);
  o = b.writeUInt16BE(height, o);
  o = b.writeUInt16BE(width, o);
  o = b.writeUInt16BE(0x0131, o);
  o = b.writeUInt16BE(36, o);
  Buffer.from(XTRANS_PATTERN).copy(b, o);
  return b;
}

/** Little-endian TIFF: IFD0 → Fujifilm sub-IFD (0xF000) → pixel strip. */
function cfaTiffBlock(rawW: number, rawH: number, width: number, height: number): Buffer {
  const subIfdOff = 8 + 2 + 12 + 4;
  const entryCount = 7;
  const wbOff = subIfdOff + 2 + entryCount * 12 + 4;
  const stripOff = wbOff + 12;
  const t = Buffer.alloc(stripOff + rawW * rawH * 2);

  t.write('II', 0, 'latin1');
  t.writeUInt16LE(42, 2);
  t.writeUInt32LE(8, 4);
  t.writeUInt16LE(1, 8);
  writeEntry(t, 10, 0xf000, 13, 1, subIfdOff);

  t.writeUInt16LE(entryCount, subIfdOff);
  const entries: Array<[number, number, number]> = [
    [0xf001, 1, rawW],
    [0xf002, 1, rawH],
    [0xf003, 1, 14],
    [0xf007, 1, stripOff],
    [0xf008, 1, rawW * rawH * 2],
    [0xf00a, 1, BLACK],
    [0xf00d, 3, wbOff],
  ];
  entries.forEach(([tag, count, value], i) => writeEntry(t, subIfdOff + 2 + i * 12, tag, 4, count, value));
  // As-shot WB [G, R, B] all equal: the gray ramp stays neutral.
  [302, 302, 302].forEach((v, i) => t.writeUInt32LE(v, wbOff + i * 4));

  const range = (1 << 14) - 1 - BLACK;
  for (let row = 0; row < rawH; row++) {
    for (let col = 0; col < rawW; col++) {
      // Overscan above the crop sits at the black level, as on real sensors.
      const x = Math.min(Math.max(col - CROP_LEFT, 0), width - 1);
      const y = Math.min(Math.max(row - CROP_TOP, 0), height - 1);
      const level = row < CROP_TOP ? 0 : syntheticRafLevel(x, y, width, height);
      t.writeUInt16LE(Math.round(BLACK + level * range), stripOff + (row * rawW + col) * 2);
    }
  }
  return t;
}

function writeEntry(b: Buffer, at: number, tag: number, type: number, count: number, value: number): void {
  b.writeUInt16LE(tag, at);
  b.writeUInt16LE(type, at + 2);
  b.writeUInt32LE(count, at + 4);
  b.writeUInt32LE(value, at + 8);
}

/** A JPEG holding only an APP1 EXIF block with the Orientation tag. */
function exifJpeg(orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const marker = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
  marker.writeUInt16BE(app1.length + 2, 4);
  return Buffer.concat([marker, app1, Buffer.from([0xff, 0xd9])]);
}
