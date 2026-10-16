import { planStorage } from "./plan-storage";
import { planStorage as webStorage, PLAN_KEY } from "./plan-storage.web";
import { loadPlan, samplePlan, savePlan, withPicks } from "./saved-plan";

// The documents directory as a map of file names to contents, so a write and
// a later read meet the way they do on a device.
const mockFiles = new Map<string, string>();
jest.mock("expo-file-system", () => ({
  Paths: { document: { uri: "file:///documents/" } },
  File: class {
    private readonly name: string;
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
      mockFiles.set(this.name, text);
    }
  },
}));

beforeEach(() => mockFiles.clear());

describe("the device file", () => {
  it("reads nothing before the first save", () => {
    expect(planStorage.read()).toBeNull();
  });

  it("brings back a saved plan the next time the app starts", () => {
    const plan = withPicks(samplePlan(), { "CSCE 2100": samplePlan().picks["CSCE 2100"] });
    savePlan(planStorage, plan);
    expect([...mockFiles.keys()]).toEqual(["guest-plan.json"]);
    expect(loadPlan(planStorage)).toEqual({ plan, problem: null });
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
