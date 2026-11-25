#!/usr/bin/env node
/**
 * Builds the folder of photos the demo reel's library is filled with
 * (docs/photonamous-demo-reel.md), from a folder of your own photos:
 *
 *   node apps/photonamous/scripts/demo-reel-library.mjs <photos> <out>
 *
 * The recording's library lives on a fake Drive that cannot take RAW files
 * (e2e/demo-reel.record.ts says why), so every photo in it is a JPEG:
 *
 * - a JPEG is linked into <out> as it is;
 * - a Fujifilm RAF gives the full-size JPEG the camera embedded in it,
 *   unless a JPEG of the same name is already there (a RAW+JPEG pair);
 * - a file named .RAF that is really a JPEG is linked like any other JPEG.
 *
 * <out> is emptied first. Nothing in <photos> is changed.
 */
import { existsSync, mkdirSync, openSync, readSync, closeSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

const [from, to] = process.argv.slice(2).map((arg) => resolve(arg));
if (!from || !to || !existsSync(from)) {
  console.error('Usage: node demo-reel-library.mjs <folder of photos> <folder to build>');
  process.exit(1);
}

const RAF_MAGIC = 'FUJIFILMCCD-RAW';

/** The first `length` bytes of a file at `position`. */
function read(path, position, length) {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, position);
    return buffer;
  } finally {
    closeSync(fd);
  }
}

const names = readdirSync(from).sort();
const stem = (name) => basename(name, extname(name));
const jpegStems = new Set(names.filter((name) => /\.jpe?g$/i.test(name)).map((name) => stem(name).toLowerCase()));

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
let linked = 0;
let extracted = 0;
for (const name of names) {
  const path = join(from, name);
  if (/\.jpe?g$/i.test(name)) {
    symlinkSync(path, join(to, `${stem(name)}.jpg`));
    linked++;
  } else if (/\.raf$/i.test(name)) {
    const head = read(path, 0, 100);
    if (head.subarray(0, RAF_MAGIC.length).toString('latin1') !== RAF_MAGIC) {
      // A JPEG with a RAW file's name.
      if (head[0] === 0xff && head[1] === 0xd8 && !jpegStems.has(stem(name).toLowerCase())) {
        symlinkSync(path, join(to, `${stem(name)}.jpg`));
        linked++;
      }
      continue;
    }
    if (jpegStems.has(stem(name).toLowerCase())) continue;
    // The RAF header gives the embedded JPEG's offset and length, big-endian, at bytes 84 and 88.
    writeFileSync(join(to, `${stem(name)}.jpg`), read(path, head.readUInt32BE(84), head.readUInt32BE(88)));
    extracted++;
  }
}
console.log(`${linked} JPEGs linked and ${extracted} RAF previews extracted into ${to}`);
