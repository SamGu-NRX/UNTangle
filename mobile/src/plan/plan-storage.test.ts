import { planStorage } from "./plan-storage";
import { planStorage as webStorage, PLAN_KEY } from "./plan-storage.web";
import { loadPlan, samplePlan, savePlan, withPicks } from "./saved-plan";

// The documents directory as a map of file names to contents, so a write and
// a later read meet the way they do on a device. `mockCut` makes the next
// write or move stop partway, the way an app killed mid-save would.
const mockFiles = new Map<string, string>();
const mockCut: { write: boolean; move: boolean } = { write: false, move: false };
jest.mock("expo-file-system", () => ({
  Paths: { document: { uri: "file:///documents/" } },
  File: class {
    readonly name: string;
    constructor(_directory: unknown, name: string) {
      this.name = name;
    }
    get exists() {
      return mockFiles.has(this.name);
    }
    textSync() {
      const text = mockFiles.get(this.name);
      if (text === undefined) throw new Error(`${this.name} does not exist`);
      return text;
    }
    write(text: string) {
      if (mockCut.write) {
        mockCut.write = false;
        mockFiles.set(this.name, text.slice(0, Math.floor(text.length / 2)));
        throw new Error("killed mid-write");
      }
      mockFiles.set(this.name, text);
    }
    // As on iOS (FileSystemPath.swift move): with overwrite, delete the destination, then move.
    moveSync(destination: { name: string }, options?: { overwrite?: boolean }) {
      const text = mockFiles.get(this.name);
      if (text === undefined) throw new Error(`${this.name} does not exist`);
      if (mockFiles.has(destination.name)) {
        if (!options?.overwrite) throw new Error(`${destination.name} already exists`);
        mockFiles.delete(destination.name);
      }
      if (mockCut.move) {
        mockCut.move = false;
        throw new Error("killed mid-move");
      }
      mockFiles.delete(this.name);
      mockFiles.set(destination.name, text);
    }
  },
}));

beforeEach(() => {
  mockFiles.clear();
  mockCut.write = false;
  mockCut.move = false;
});

describe("the device file", () => {
  const before = samplePlan();
  const after = withPicks(before, { "CSCE 2100": before.picks["CSCE 2100"] });

  it("reads nothing before the first save", () => {
    expect(planStorage.read()).toBeNull();
  });

  it("brings back a saved plan the next time the app starts", () => {
    savePlan(planStorage, after);
    expect([...mockFiles.keys()]).toEqual(["guest-plan.json"]);
    expect(loadPlan(planStorage)).toEqual({ plan: after, problem: null });
  });

  it("keeps the previous plan readable when a save is cut off midway", () => {
    savePlan(planStorage, before);
    mockCut.write = true;
    expect(() => savePlan(planStorage, after)).toThrow("killed mid-write");
    expect(loadPlan(planStorage)).toEqual({ plan: before, problem: null });
  });

  it("brings back the new plan when a save is cut off after the old file is removed", () => {
    savePlan(planStorage, before);
    mockCut.move = true;
    expect(() => savePlan(planStorage, after)).toThrow("killed mid-move");
    expect(mockFiles.has("guest-plan.json")).toBe(false);
    expect(loadPlan(planStorage)).toEqual({ plan: after, problem: null });
  });
});

describe("web storage", () => {
  const local = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  beforeAll(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => local.get(key) ?? null,
        setItem: (key: string, value: string) => void local.set(key, value),
      },
    });
  });
  afterAll(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("keeps the plan under its one key across a reload", () => {
    expect(webStorage.read()).toBeNull();
    const plan = withPicks(samplePlan(), {});
    savePlan(webStorage, plan);
    expect([...local.keys()]).toEqual([PLAN_KEY]);
    expect(loadPlan(webStorage)).toEqual({ plan, problem: null });
  });
});
