/**
 * Scale benchmark (spec 11: 50,000 photos). Skipped unless LOPSY_BENCH=1:
 *   LOPSY_BENCH=1 npx vitest run src/library/scale.bench.test.ts
 * from packages/photos-core. Prints a table of timings and sizes.
 */
import { describe, expect, it } from "vitest";
import { MemoryLocalStore } from "./local-store";
import { openLibrary } from "./session";
import { decodeSnapshot, encodeSnapshot, listSnapshots } from "./snapshot";
import { TestAdapter } from "./test-support/test-adapter";
import type { LibrarySession, NewAsset } from "./types";

interface NodeProcess {
  env: Record<string, string | undefined>;
  memoryUsage(): { heapUsed: number };
}
const proc = (globalThis as { process?: NodeProcess }).process;
const enabled = proc?.env.LOPSY_BENCH === "1";

const ASSETS = Number(proc?.env.LOPSY_BENCH_ASSETS ?? 50_000);
const KEYWORDS = [
  "beach",
  "city",
  "family",
  "night",
  "portrait",
  "street",
  "travel",
  "winter",
  "dog",
  "food",
];

function photo(n: number): NewAsset {
  const day = 1 + (n % 28);
  return {
    kind: "original",
    fileId: `1AbCdEfGhIjKlMnOpQrStUvWxYz${n.toString(36).padStart(6, "0")}`,
    sha256: (n * 2654435761)
      .toString(16)
      .padStart(16, "0")
      .repeat(4)
      .slice(0, 64),
    fileName: `DSCF${String(n % 10000).padStart(4, "0")}.RAF`,
    byteSize: 30_000_000 + (n % 5_000_000),
    format: "raf",
    mimeType: "image/x-fujifilm-raf",
    capturedAt: `2026-${String(1 + (n % 12)).padStart(2, "0")}-${String(day).padStart(2, "0")}T16:02:11+01:00`,
    importedAt: "2026-11-15T10:00:00.000Z",
    importId: `imp-${Math.floor(n / 500)}`,
    width: 6240,
    height: 4160,
    orientation: 1,
    camera: { make: "FUJIFILM", model: "X-T5" },
    lens: "XF33mmF1.4 R LM WR",
    exposure: {
      iso: 200 + (n % 6) * 100,
      shutter: "1/250",
      aperture: 2.8,
      focalLength: 33,
    },
    gps:
      n % 3 === 0
        ? { lat: 51.5 + (n % 100) / 1000, lon: -0.12, alt: 12 }
        : null,
    pairedWith: null,
    source: null,
    renderFileId: null,
    keywords: [
      KEYWORDS[n % KEYWORDS.length]!,
      KEYWORDS[(n * 7) % KEYWORDS.length]!,
    ],
    marks: { rating: (n % 6) as 0 | 1 | 2 | 3 | 4 | 5 },
  };
}

const rows: [string, string][] = [];
function record(label: string, value: string): void {
  rows.push([label, value]);
}
async function time<T>(label: string, work: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await work();
  record(label, `${(performance.now() - start).toFixed(1)} ms`);
  return result;
}
function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

describe.skipIf(!enabled)("scale: 50,000 photos", () => {
  it("builds, edits, syncs, snapshots and reopens a large library", async () => {
    const adapter = new TestAdapter();
    const store = new MemoryLocalStore();
    const heap0 = proc!.memoryUsage().heapUsed;
    const heap = (label: string) =>
      record(label, mb(proc!.memoryUsage().heapUsed - heap0));
    // Each phase runs in its own function so its session can be collected afterwards, as when a tab reloads.
    const build = async (): Promise<string> => {
      const a: LibrarySession = await openLibrary({
        adapter,
        store,
        autoSync: false,
        snapshotEvery: 1e12,
      });

      const ids = await time(
        `addAsset x${ASSETS} (batches of 1000)`,
        async () => {
          const out: { assetId: string; versionId: string }[] = [];
          for (let n = 0; n < ASSETS; n++) {
            out.push(a.addAsset(photo(n)));
            if (n % 1000 === 999) await Promise.resolve();
          }
          return out;
        },
      );
      await time("createVersion x1000", () => {
        for (let i = 0; i < 1000; i++)
          a.createVersion(ids[(i * 7) % ASSETS]!.assetId, "Black and white");
      });
      await time("20 albums x 500 members", () => {
        for (let al = 0; al < 20; al++) {
          const album = a.createAlbum(`Album ${al}`);
          for (let i = 0; i < 500; i++)
            a.setAlbumMember(
              album,
              ids[(al * 500 + i * 3) % ASSETS]!.assetId,
              true,
            );
        }
      });
      heap("heap after build");

      const target = ids[12_345 % ASSETS]!;
      const samples: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        a.setMarks([target.assetId], {
          rating: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5,
        });
        a.getView();
        samples.push(performance.now() - start);
      }
      samples.sort((x, y) => x - y);
      record("setMarks(1) + getView, median", `${samples[50]!.toFixed(3)} ms`);
      record("setMarks(1) + getView, p95", `${samples[95]!.toFixed(3)} ms`);
      expect(samples[50]!).toBeLessThan(5);

      const edits: number[] = [];
      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        a.editRecipe(
          target.versionId,
          { "tone.exposure": i / 100 },
          "Exposure",
        );
        a.getView();
        edits.push(performance.now() - start);
      }
      edits.sort((x, y) => x - y);
      record("editRecipe(1) + getView, median", `${edits[50]!.toFixed(3)} ms`);

      await time("syncNow after build (flush + state save)", () => a.syncNow());
      const ownFolder = (await adapter.listChildren(a.layout.journalId)).find(
        (f) => f.name === a.deviceId,
      )!;
      const segments = await adapter.listChildren(ownFolder.id);
      record(
        "segments written",
        `${segments.length}, total ${mb(segments.reduce((s, f) => s + f.size, 0))}`,
      );
      record("largest segment", mb(Math.max(...segments.map((f) => f.size))));

      const saved = await store.load(a.libraryId);
      const serialized = saved!.state!;
      record(
        "saved state on the device (JSON)",
        mb(JSON.stringify(serialized).length),
      );
      const blob = await time("encode snapshot (gzip)", () =>
        encodeSnapshot({
          format: 1,
          libraryId: a.libraryId,
          device: a.deviceId,
          hlc: `000000000000001-00000-${a.deviceId}`,
          vector: {},
          store: serialized,
        }),
      );
      record("snapshot size (gzip)", mb(blob.size));
      await time("decode snapshot", () => decodeSnapshot(blob));
      await a.close();
      return a.libraryId;
    };
    const libraryId = await build();
    heap("heap after the build session is dropped (not GC-forced)");

    await (async () => {
      const writer = await openLibrary({
        adapter,
        store,
        autoSync: false,
        snapshotEvery: 1,
      });
      writer.setSetting("bench", 1);
      await time("syncNow writing a snapshot", () => writer.syncNow());
      const snaps = await listSnapshots(adapter, writer.layout.snapshotsId);
      record("snapshot file in storage", mb(snaps[0]!.size));
      await writer.close();
    })();

    await (async () => {
      const cold = await time("cold openLibrary from the local store", () =>
        openLibrary({ adapter, store, autoSync: false }),
      );
      expect(cold.getView().assets.size).toBe(ASSETS);
      expect(cold.libraryId).toBe(libraryId);
      await cold.close();
    })();

    const fresh = await time(
      "fresh device: openLibrary (bootstrap from snapshot)",
      () =>
        openLibrary({
          adapter,
          store: new MemoryLocalStore(),
          autoSync: false,
        }),
    );
    await time("fresh device: first syncNow", () => fresh.syncNow());
    expect(fresh.getView().assets.size).toBe(ASSETS);
    heap("heap at end (one fresh session live)");

    console.warn(
      "\n" + rows.map(([k, v]) => `${k.padEnd(52)} ${v}`).join("\n"),
    );
  }, 600_000);
});
