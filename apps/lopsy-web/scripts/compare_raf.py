#!/usr/bin/env python3
"""Compare Lopsy's RAF decode output to the camera-rendered JPG reference.

Reads /tmp/lopsy_out.jpg and /tmp/target.jpg, resizes to the smaller of the
two, computes mean / max / RMS per-channel distance, and prints summary
statistics that drive decoder tuning.

Usage:
    python3 scripts/compare_raf.py
"""
from __future__ import annotations

import struct
import sys
import subprocess
import zlib
from pathlib import Path


def decode_jpeg_via_python(path: Path) -> tuple[int, int, list[tuple[int, int, int]]]:
    """Decode a JPEG using sips (macOS) to a temp PNG, then parse the PNG."""
    tmp_png = Path(f"/tmp/_cmp_{path.stem}.png")
    subprocess.run(
        ["sips", "-s", "format", "png", str(path), "--out", str(tmp_png)],
        check=True, capture_output=True,
    )
    return decode_png(tmp_png)


def decode_png(path: Path) -> tuple[int, int, list[tuple[int, int, int]]]:
    """Minimal PNG decoder: read width, height, and RGB pixels."""
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", f"Not a PNG: {path}"

    width = height = bit_depth = color_type = 0
    idat = bytearray()

    i = 8
    while i < len(data):
        length = struct.unpack(">I", data[i:i+4])[0]
        chunk_type = data[i+4:i+8]
        chunk_data = data[i+8:i+8+length]
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(
                ">IIBB", chunk_data[:10],
            )
        elif chunk_type == b"IDAT":
            idat.extend(chunk_data)
        elif chunk_type == b"IEND":
            break
        i += 8 + length + 4

    raw = zlib.decompress(bytes(idat))

    # Channels per pixel from color_type
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    bytes_per_pixel = channels * (bit_depth // 8)
    stride = width * bytes_per_pixel

    pixels: list[tuple[int, int, int]] = []
    prev_row = bytearray(stride)
    pos = 0
    for _ in range(height):
        filt = raw[pos]
        pos += 1
        row = bytearray(raw[pos:pos+stride])
        pos += stride
        if filt == 0:
            pass
        elif filt == 1:  # Sub
            for x in range(bytes_per_pixel, stride):
                row[x] = (row[x] + row[x - bytes_per_pixel]) & 0xFF
        elif filt == 2:  # Up
            for x in range(stride):
                row[x] = (row[x] + prev_row[x]) & 0xFF
        elif filt == 3:  # Average
            for x in range(stride):
                left = row[x - bytes_per_pixel] if x >= bytes_per_pixel else 0
                row[x] = (row[x] + (left + prev_row[x]) // 2) & 0xFF
        elif filt == 4:  # Paeth
            for x in range(stride):
                a = row[x - bytes_per_pixel] if x >= bytes_per_pixel else 0
                b = prev_row[x]
                c = prev_row[x - bytes_per_pixel] if x >= bytes_per_pixel else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                if pa <= pb and pa <= pc:
                    paeth = a
                elif pb <= pc:
                    paeth = b
                else:
                    paeth = c
                row[x] = (row[x] + paeth) & 0xFF
        prev_row = row

        for x in range(0, stride, bytes_per_pixel):
            if channels >= 3:
                pixels.append((row[x], row[x+1], row[x+2]))
            else:
                v = row[x]
                pixels.append((v, v, v))

    return width, height, pixels


def srgb_to_linear(c: float) -> float:
    """Convert sRGB to linear light. c in 0..1."""
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def linear_to_lab(r: float, g: float, b: float) -> tuple[float, float, float]:
    """Convert linear RGB to CIELAB (D65)."""
    # Linear RGB → XYZ (sRGB D65)
    x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b

    # Normalize by D65 reference white
    x /= 0.95047
    z /= 1.08883

    def f(t: float) -> float:
        if t > (6/29) ** 3:
            return t ** (1/3)
        return t * (1/3) * (29/6) ** 2 + 4/29

    fx, fy, fz = f(x), f(y), f(z)
    return (
        116 * fy - 16,
        500 * (fx - fy),
        200 * (fy - fz),
    )


def main() -> int:
    target_path = Path("/tmp/target.jpg")
    out_path = Path("/tmp/lopsy_out.jpg")

    if not target_path.exists():
        print(f"Missing {target_path}. Copy the reference JPG there first.", file=sys.stderr)
        return 2
    if not out_path.exists():
        print(f"Missing {out_path}. Run the RAF compare test first.", file=sys.stderr)
        return 2

    print(f"Decoding {target_path}...")
    tw, th, tpix = decode_jpeg_via_python(target_path)
    print(f"Target: {tw}×{th}, {len(tpix)} pixels")

    print(f"Decoding {out_path}...")
    ow, oh, opix = decode_jpeg_via_python(out_path)
    print(f"Lopsy:  {ow}×{oh}, {len(opix)} pixels")

    # Resize the LOPSY output to TARGET dimensions via sips
    if (ow, oh) != (tw, th):
        print(f"Resizing Lopsy {ow}×{oh} → {tw}×{th} (target size) for comparison...")
        tmp_resized = Path("/tmp/_lopsy_resized.jpg")
        subprocess.run(
            ["sips", "-z", str(th), str(tw), str(out_path), "--out", str(tmp_resized)],
            check=True, capture_output=True,
        )
        ow, oh, opix = decode_jpeg_via_python(tmp_resized)
        print(f"Resized Lopsy: {ow}×{oh}")

    assert (ow, oh) == (tw, th), f"Size mismatch: {(ow, oh)} vs {(tw, th)}"

    # Per-channel stats over the inner 80% (avoid border noise)
    margin_x = tw // 10
    margin_y = th // 10
    diffs_r, diffs_g, diffs_b = [], [], []
    delta_e_sum = 0.0
    delta_e_max = 0.0
    n = 0

    for y in range(margin_y, th - margin_y):
        for x in range(margin_x, tw - margin_x):
            i = y * tw + x
            tr, tg, tb = tpix[i]
            or_, og, ob = opix[i]
            diffs_r.append(or_ - tr)
            diffs_g.append(og - tg)
            diffs_b.append(ob - tb)

            # CIE76 delta E
            tlab = linear_to_lab(
                srgb_to_linear(tr/255), srgb_to_linear(tg/255), srgb_to_linear(tb/255),
            )
            olab = linear_to_lab(
                srgb_to_linear(or_/255), srgb_to_linear(og/255), srgb_to_linear(ob/255),
            )
            de = ((tlab[0]-olab[0])**2 + (tlab[1]-olab[1])**2 + (tlab[2]-olab[2])**2) ** 0.5
            delta_e_sum += de
            if de > delta_e_max:
                delta_e_max = de
            n += 1

    def stats(label: str, arr: list[int]) -> None:
        mean = sum(arr) / len(arr)
        sq = sum(a*a for a in arr) / len(arr)
        rms = sq ** 0.5
        print(f"  {label}: mean bias = {mean:+6.1f}, RMS = {rms:5.1f}")

    print()
    print("== Per-channel diffs (Lopsy - Target) in inner 80% ==")
    stats("R", diffs_r)
    stats("G", diffs_g)
    stats("B", diffs_b)
    print()
    print(f"Mean ΔE76 = {delta_e_sum/n:5.2f}")
    print(f"Max  ΔE76 = {delta_e_max:5.2f}")

    # Sample a few specific regions
    print()
    print("== Sample regions (Lopsy → Target) ==")
    regions = [
        ("sky (top center)", tw // 2, th // 20),
        ("yellow wall mid", tw // 2, th // 2),
        ("blue archway", tw // 2, int(th * 0.65)),
        ("garage door", int(tw * 0.85), int(th * 0.85)),
        ("tree foliage", int(tw * 0.1), int(th * 0.25)),
        ("pavement", tw // 2, int(th * 0.95)),
    ]
    for name, x, y in regions:
        i = y * tw + x
        tr, tg, tb = tpix[i]
        or_, og, ob = opix[i]
        print(f"  {name:18s} target=({tr:3d},{tg:3d},{tb:3d})  lopsy=({or_:3d},{og:3d},{ob:3d})  Δ=({or_-tr:+4d},{og-tg:+4d},{ob-tb:+4d})")

    return 0


if __name__ == "__main__":
    sys.exit(main())
