import {
  beginUnsafeMoment,
  endUnsafeMoment,
  isSafeToApply,
  unsafeMomentCount,
} from "./safe-moment";

describe("safe-moment registry", () => {
  beforeEach(() => {
    // Leave no hold behind for the next test, however one fails.
    while (!isSafeToApply()) {
      endUnsafeMoment("test");
      endUnsafeMoment("other");
    }
  });

  test("is safe when nothing holds", () => {
    expect(isSafeToApply()).toBe(true);
  });

  test("an open hold blocks applying until it closes", () => {
    beginUnsafeMoment("import-review");
    expect(isSafeToApply()).toBe(false);
    endUnsafeMoment("import-review");
    expect(isSafeToApply()).toBe(true);
  });

  test("holds refcount by label, so two holders cannot release each other's", () => {
    beginUnsafeMoment("auto");
    beginUnsafeMoment("auto");
    expect(unsafeMomentCount()).toBe(1);
    endUnsafeMoment("auto");
    expect(isSafeToApply()).toBe(false);
    endUnsafeMoment("auto");
    expect(isSafeToApply()).toBe(true);
  });

  test("separate labels hold independently", () => {
    beginUnsafeMoment("import-review");
    beginUnsafeMoment("conflict");
    expect(unsafeMomentCount()).toBe(2);
    endUnsafeMoment("import-review");
    expect(isSafeToApply()).toBe(false);
    endUnsafeMoment("conflict");
    expect(isSafeToApply()).toBe(true);
  });

  test("closing an unheld label is a no-op", () => {
    endUnsafeMoment("never-opened");
    expect(isSafeToApply()).toBe(true);
  });

  test("closing twice does not count an extra holder", () => {
    beginUnsafeMoment("auto");
    endUnsafeMoment("auto");
    endUnsafeMoment("auto");
    expect(isSafeToApply()).toBe(true);
  });
});
