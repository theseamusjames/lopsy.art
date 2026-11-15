import { parseABR } from './abr-parser';

self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  const brushes = parseABR(e.data);
  const transferables = brushes.map((b) => b.data.buffer);
  self.postMessage(brushes, { transfer: transferables });
};
