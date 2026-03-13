export function compositeOver(
  topData: Uint8ClampedArray,
  _bottomData: Uint8ClampedArray,
  topWidth: number,
  topHeight: number,
  bottomWidth: number,
  bottomHeight: number,
  offsetX: number,
  offsetY: number,
  topOpacity: number,
  resultData: Uint8ClampedArray,
): void {
  for (let y = 0; y < topHeight; y++) {
    const destY = y + offsetY;
    if (destY < 0 || destY >= bottomHeight) continue;
    for (let x = 0; x < topWidth; x++) {
      const destX = x + offsetX;
      if (destX < 0 || destX >= bottomWidth) continue;
      const si = (y * topWidth + x) * 4;
      const di = (destY * bottomWidth + destX) * 4;
      const sa = ((topData[si + 3] ?? 0) / 255) * topOpacity;
      if (sa <= 0) continue;
      const da = (resultData[di + 3] ?? 0) / 255;
      const outA = sa + da * (1 - sa);
      if (outA > 0) {
        resultData[di] = Math.round(
          ((topData[si] ?? 0) * sa + (resultData[di] ?? 0) * da * (1 - sa)) / outA,
        );
        resultData[di + 1] = Math.round(
          ((topData[si + 1] ?? 0) * sa + (resultData[di + 1] ?? 0) * da * (1 - sa)) / outA,
        );
        resultData[di + 2] = Math.round(
          ((topData[si + 2] ?? 0) * sa + (resultData[di + 2] ?? 0) * da * (1 - sa)) / outA,
        );
        resultData[di + 3] = Math.round(outA * 255);
      }
    }
  }
}
