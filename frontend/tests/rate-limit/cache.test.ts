import { expect, test } from "bun:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { IndexedDbResponseCache, MemoryResponseCache, type CachedResponse } from "@/lib/rate-limit/client-cache";

function value(expiresAt: number): CachedResponse {
  return { body: new TextEncoder().encode("cached").buffer, status: 200, headers: [["content-type", "text/plain"]], expiresAt };
}

test("memory cache enforces TTL and its entry cap", async () => {
  let now = 1000;
  const cache = new MemoryResponseCache(() => now, 2);
  await cache.put("a", value(1500));
  await cache.put("b", value(2000));
  await cache.put("c", value(3000));
  expect(await cache.get("a")).toBeUndefined();
  expect(await cache.get("b")).toEqual(value(2000));
  now = 2000;
  expect(await cache.get("b")).toBeUndefined();
  expect(new TextDecoder().decode((await cache.get("c"))!.body)).toBe("cached");
});

test("IndexedDB persists between cache instances, expires entries and limits storage", async () => {
  const previous = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = IDBKeyRange;
  try {
    let now = 1000;
    const factory = new IDBFactory();
    const firstTab = new IndexedDbResponseCache(factory, () => now);
    const secondTab = new IndexedDbResponseCache(factory, () => now);
    await firstTab.put("shared", value(2000));
    expect(new TextDecoder().decode((await secondTab.get("shared"))!.body)).toBe("cached");
    now = 2000;
    expect(await secondTab.get("shared")).toBeUndefined();
    for (let i = 0; i < 201; i++) await firstTab.put(`entry-${i}`, value(3000 + i));
    expect(await secondTab.get("entry-0")).toBeUndefined();
    expect((await secondTab.get("entry-200"))?.expiresAt).toBe(3200);
  } finally { globalThis.IDBKeyRange = previous; }
});
