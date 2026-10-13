import { describe, expect, test } from "bun:test";
import {
  MYUNT_WINDOW,
  openMyUnt,
  popupFeatures,
  tripReducer,
  type PopupHandle,
  type Trip,
} from "../../src/components/connect/myunt-trip";
import { filePicker, pickPdf, PDF_PICKER_OPTIONS } from "../../src/components/connect/pick-pdf";
import { isFileDrag, readDrop } from "../../src/components/connect/pdf-drop";
import { clearTripFlag, readTripFlag, setTripFlag, TRIP_KEY } from "../../src/components/connect/trip-flag";
import { CLOSED_FRAME, nextFrame } from "../../src/components/connect/host-frame";

const geometry = {
  screenX: 100,
  screenY: 50,
  outerWidth: 1440,
  outerHeight: 900,
  screen: { availWidth: 1680, availHeight: 1000 },
};

describe("the trip to myUNT", () => {
  const away = (via: "popup" | "tab", left = false): Trip => ({ stage: "away", via, left });

  test("opening myUNT starts a trip that has not left the page yet", () => {
    expect(tripReducer({ stage: "idle" }, { type: "opened", via: "popup" })).toEqual(away("popup"));
    expect(tripReducer({ stage: "back" }, { type: "opened", via: "tab" })).toEqual(away("tab"));
  });

  test("focus that never left is not a return; leaving then coming back is", () => {
    expect(tripReducer(away("popup"), { type: "returned" })).toEqual(away("popup"));
    const left = tripReducer(away("popup"), { type: "left" });
    expect(left).toEqual(away("popup", true));
    expect(tripReducer(left, { type: "returned" })).toEqual({ stage: "back" });
  });

  test("closing the popup returns, even if the page never lost focus", () => {
    expect(tripReducer(away("popup"), { type: "popupClosed" })).toEqual({ stage: "back" });
  });

  test("a tab has no handle to close, so only focus or visibility brings it back", () => {
    expect(tripReducer(away("tab"), { type: "popupClosed" })).toEqual(away("tab"));
    expect(tripReducer(tripReducer(away("tab"), { type: "left" }), { type: "returned" })).toEqual({ stage: "back" });
  });

  test("signals outside a trip change nothing, and repeated signals keep the same state object", () => {
    const idle: Trip = { stage: "idle" };
    for (const type of ["left", "returned", "popupClosed"] as const) {
      expect(tripReducer(idle, { type })).toBe(idle);
    }
    const left = away("popup", true);
    expect(tripReducer(left, { type: "left" })).toBe(left);
  });

  test("reset ends any trip", () => {
    expect(tripReducer(away("popup", true), { type: "reset" })).toEqual({ stage: "idle" });
    expect(tripReducer({ stage: "back" }, { type: "reset" })).toEqual({ stage: "idle" });
  });
});

describe("the myUNT window", () => {
  test("is 1000x800, centred over this window", () => {
    expect(popupFeatures(geometry)).toBe("popup=yes,width=1000,height=800,left=320,top=100");
  });

  test("shrinks to fit a small screen and never sits off-screen", () => {
    const small = { screenX: 0, screenY: 0, outerWidth: 390, outerHeight: 844, screen: { availWidth: 390, availHeight: 844 } };
    expect(popupFeatures(small)).toBe("popup=yes,width=320,height=764,left=35,top=40");
    expect(popupFeatures({ ...small, screenX: -500 })).toContain("left=0");
  });

  function fakeWindow(result: PopupHandle | null) {
    const calls: Array<[string, string, string]> = [];
    return {
      calls,
      win: {
        ...geometry,
        open(url: string, target: string, features: string) {
          calls.push([url, target, features]);
          return result;
        },
      },
    };
  }

  test("a blocked popup reports a tab, so the link opens myUNT itself", () => {
    const { win, calls } = fakeWindow(null);
    expect(openMyUnt(win, "https://my.unt.edu/x")).toEqual({ via: "tab" });
    expect(calls[0][1]).toBe(MYUNT_WINDOW);
  });

  test("a new popup is cut off from this page before it navigates, and keeps its handle", () => {
    const handle = { closed: false, opener: {} as unknown, location: { href: "about:blank" }, focused: false, focus() { this.focused = true; } };
    const { win, calls } = fakeWindow(handle);
    const opened = openMyUnt(win, "https://my.unt.edu/x");
    expect(calls[0][0]).toBe("");
    expect(opened).toEqual({ via: "popup", handle });
    expect(handle.opener).toBeNull();
    expect(handle.location.href).toBe("https://my.unt.edu/x");
    expect(handle.focused).toBe(true);
  });

  test("an existing myUNT window (cross-origin) is focused, not sent back to the start", () => {
    const location = {
      get href(): string {
        throw new DOMException("Blocked a frame from accessing a cross-origin frame.", "SecurityError");
      },
      set href(_value: string) {
        throw new Error("must not navigate an existing myUNT window");
      },
    };
    let focused = false;
    const handle = { closed: false, opener: null, location, focus() { focused = true; } };
    const { win } = fakeWindow(handle);
    expect(openMyUnt(win, "https://my.unt.edu/x").via).toBe("popup");
    expect(focused).toBe(true);
  });
});

describe("choosing the downloaded PDF", () => {
  const pdf = new File(["%PDF-1.4"], "transcript.pdf", { type: "application/pdf" });

  test("without the File System Access picker the caller falls back to the file input", () => {
    expect(filePicker({})).toBeNull();
  });

  test("the picker opens in Downloads, for one PDF", async () => {
    let seen: unknown;
    const show = filePicker({
      showOpenFilePicker: async (options) => {
        seen = options;
        return [{ getFile: async () => pdf }];
      },
    });
    expect(show).not.toBeNull();
    expect(await pickPdf(show!)).toEqual({ kind: "file", file: pdf });
    expect(seen).toBe(PDF_PICKER_OPTIONS);
    expect(PDF_PICKER_OPTIONS.startIn).toBe("downloads");
    expect(PDF_PICKER_OPTIONS.types[0].accept).toEqual({ "application/pdf": [".pdf"] });
  });

  test("cancelling the picker is silent", async () => {
    const abort = async () => {
      throw new DOMException("The user aborted a request.", "AbortError");
    };
    expect(await pickPdf(abort)).toEqual({ kind: "cancelled" });
  });

  test("a picker that refuses (e.g. in a cross-origin frame) falls back to the file input", async () => {
    const refuse = async () => {
      throw new DOMException("Cross origin sub frames aren't allowed to show a file picker.", "SecurityError");
    };
    expect(await pickPdf(refuse)).toEqual({ kind: "fallback" });
  });

  test("a picker that returns nothing counts as cancelled", async () => {
    expect(await pickPdf(async () => [])).toEqual({ kind: "cancelled" });
  });
});

describe("dropping a PDF anywhere", () => {
  const file = (name: string, type: string) => new File(["x"], name, { type });

  test("only drags that carry files count", () => {
    expect(isFileDrag(["Files"])).toBe(true);
    expect(isFileDrag(["text/plain", "text/uri-list"])).toBe(false);
    expect(isFileDrag(null)).toBe(false);
  });

  test("one PDF is accepted, by type or by name", () => {
    const typed = file("a.pdf", "application/pdf");
    expect(readDrop([typed])).toEqual({ kind: "file", file: typed });
    const untyped = file("Unofficial Transcript.PDF", "");
    expect(readDrop([untyped])).toEqual({ kind: "file", file: untyped });
  });

  test("two files, a non-PDF, or nothing are refused with a reason", () => {
    const two = readDrop([file("a.pdf", "application/pdf"), file("b.pdf", "application/pdf")]);
    expect(two).toMatchObject({ kind: "error" });
    expect(two.kind === "error" && two.message).toContain("2 files");
    const png = readDrop([file("photo.png", "image/png")]);
    expect(png.kind === "error" && png.message).toContain("“photo.png” isn't a PDF");
    expect(readDrop([])).toMatchObject({ kind: "error" });
  });
});

describe("the return flag", () => {
  function memory() {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
  }

  test("is set by a trip, read back, and cleared", () => {
    const store = memory();
    expect(readTripFlag(store)).toBe(false);
    setTripFlag(store);
    expect(store.map.get(TRIP_KEY)).toBe("1");
    expect(readTripFlag(store)).toBe(true);
    clearTripFlag(store);
    expect(readTripFlag(store)).toBe(false);
  });

  test("denied storage reads as no trip and never throws", () => {
    const denied = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("denied", "QuotaExceededError");
      },
      removeItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    expect(readTripFlag(denied)).toBe(false);
    expect(() => setTripFlag(denied)).not.toThrow();
    expect(() => clearTripFlag(denied)).not.toThrow();
    expect(readTripFlag(null)).toBe(false);
  });
});

describe("the sheet's container", () => {
  const noTrip = () => false;

  test("is chosen when the sheet opens", () => {
    expect(nextFrame(CLOSED_FRAME, true, true, noTrip)).toEqual({ open: true, phone: true, restoreTrip: false });
    expect(nextFrame(CLOSED_FRAME, true, false, () => true)).toEqual({ open: true, phone: false, restoreTrip: true });
  });

  test("holds across the breakpoint while open, so the sheet is not remounted mid-import", () => {
    const opened = nextFrame(CLOSED_FRAME, true, false, noTrip);
    // A phone rotating or a desktop zooming past 719px flips isPhone.
    expect(nextFrame(opened, true, true, noTrip)).toBe(opened);
    expect(nextFrame(opened, true, false, noTrip)).toBe(opened);
  });

  test("keeps its container through the close, then takes the new one on the next open", () => {
    const opened = nextFrame(CLOSED_FRAME, true, false, noTrip);
    const closed = nextFrame(opened, false, true, noTrip);
    expect(closed).toEqual({ open: false, phone: false, restoreTrip: false });
    expect(nextFrame(closed, true, true, noTrip)).toEqual({ open: true, phone: true, restoreTrip: false });
  });

  test("reads the trip flag once per opening", () => {
    let reads = 0;
    const read = () => {
      reads += 1;
      return true;
    };
    const opened = nextFrame(CLOSED_FRAME, true, false, read);
    nextFrame(opened, true, true, read);
    nextFrame(opened, true, false, read);
    expect(reads).toBe(1);
  });
});
