import { describe, expect, test } from "bun:test";
import { foldAccents, foldName, stripSuffixTokens, tokenize } from "../../src/lib/instructors/fold";
import { parseSectionField } from "../../src/lib/instructors/parse";

describe("foldName", () => {
  test("folds accents through the explicit map, not locale APIs", () => {
    expect(foldName("Muñoz")).toBe("munoz");
    expect(foldName("Cöreås")).toBe("coreas");
    expect(foldName("ß StraßE")).toBe("ss strasse");
  });

  test("strips apostrophes and periods, widens hyphens to spaces", () => {
    expect(foldName("O'Brien")).toBe("obrien");
    expect(foldName("Dan J.")).toBe("dan j");
    expect(foldName("Ala'I-Rosales")).toBe("alai rosales");
  });

  test("collapses whitespace and keeps structural separators", () => {
    expect(foldName("  Jane   Smith ")).toBe("jane smith");
    expect(foldName("Mann,Allen")).toBe("mann,allen");
  });
});

describe("foldAccents", () => {
  test("leaves ASCII untouched and maps typographic quotes", () => {
    expect(foldAccents("Mann, Allen")).toBe("Mann, Allen");
    expect(foldAccents("O\u2019Brien")).toBe("O'Brien");
  });
});

describe("tokenize", () => {
  test("splits on every non-alphanumeric run", () => {
    expect(tokenize("garcia-lopez juan")).toEqual(["garcia", "lopez", "juan"]);
    expect(tokenize("!!!")).toEqual([]);
  });
});

describe("stripSuffixTokens", () => {
  test("strips trailing suffixes and keeps at least one token", () => {
    expect(stripSuffixTokens(["curran", "jr"])).toEqual({ tokens: ["curran"], suffix: "jr" });
    expect(stripSuffixTokens(["crossley", "ii"])).toEqual({ tokens: ["crossley"], suffix: "ii" });
    expect(stripSuffixTokens(["jr"])).toEqual({ tokens: ["jr"], suffix: null });
  });

  test("leaves non-suffix tokens alone", () => {
    expect(stripSuffixTokens(["smith", "john"])).toEqual({ tokens: ["smith", "john"], suffix: null });
  });
});

describe("parseSectionField", () => {
  test("the Staff, TBA, Closed, None and blank placeholders are unusable", () => {
    for (const word of ["Staff", "TBA", "Closed", "None", "", "   "]) {
      const parsed = parseSectionField(word);
      expect(parsed.kind).toBe("unusable");
      if (parsed.kind === "unusable") {
        expect(["tba", "staff", "closed", "none", "blank"]).toContain(parsed.word);
      }
    }
  });

  test("a raw comma pair parses to surname and first tokens", () => {
    const parsed = parseSectionField("Mann,Allen");
    expect(parsed).toEqual({
      kind: "people",
      people: [{ surnameTokens: ["mann"], firstTokens: ["allen"], suffix: null }],
    });
  });

  test("None strips away before pairing, realigning the pairs", () => {
    const parsed = parseSectionField("None, Lee,Annie Seong");
    expect(parsed).toEqual({
      kind: "people",
      people: [{ surnameTokens: ["lee"], firstTokens: ["annie", "seong"], suffix: null }],
    });
  });

  test("a stray None glued to a team field realigns its pairs", () => {
    const parsed = parseSectionField("None Cunningham,Bruce Vincent, Wolfe,Trae Colton");
    expect(parsed).toEqual({
      kind: "people",
      people: [
        { surnameTokens: ["cunningham"], firstTokens: ["bruce", "vincent"], suffix: null },
        { surnameTokens: ["wolfe"], firstTokens: ["trae", "colton"], suffix: null },
      ],
    });
  });

  test("trailing None placeholders vanish from the last first-name slot", () => {
    const parsed = parseSectionField("Russell,Stephanie, Hudson Jr.,John Henry, Lavery,Sharon Ruth None None None None");
    expect(parsed.kind).toBe("people");
    if (parsed.kind === "people") {
      expect(parsed.people).toEqual([
        { surnameTokens: ["russell"], firstTokens: ["stephanie"], suffix: null },
        { surnameTokens: ["hudson"], firstTokens: ["john", "henry"], suffix: "jr" },
        { surnameTokens: ["lavery"], firstTokens: ["sharon", "ruth"], suffix: null },
      ]);
    }
  });

  test("a suffix with a period strips from the surname slot", () => {
    const parsed = parseSectionField("Gonzalez Jr.,Eddie J");
    expect(parsed).toEqual({
      kind: "people",
      people: [{ surnameTokens: ["gonzalez"], firstTokens: ["eddie", "j"], suffix: "jr" }],
    });
  });

  test("an odd part count after None stripping is unparseable", () => {
    const parsed = parseSectionField("Smith,John, Doe");
    expect(parsed.kind).toBe("unparseable");
  });

  test("a display-form First Last parses to the same person as its raw pair", () => {
    const display = parseSectionField("Anthony A Curran Jr");
    expect(display).toEqual({
      kind: "people",
      people: [{ surnameTokens: ["curran"], firstTokens: ["anthony", "a"], suffix: "jr" }],
    });
    expect(parseSectionField("Curran Jr,Anthony A")).toEqual(display);
  });

  test("multi-person display form splits on semicolons", () => {
    const parsed = parseSectionField("Jaime Enrique Jimenez; Samuel J Ogden Jr");
    expect(parsed.kind).toBe("people");
    if (parsed.kind === "people") {
      expect(parsed.people).toEqual([
        { surnameTokens: ["jimenez"], firstTokens: ["jaime", "enrique"], suffix: null },
        { surnameTokens: ["ogden"], firstTokens: ["samuel", "j"], suffix: "jr" },
      ]);
    }
  });

  test("a stray single token parses to a surname-only person", () => {
    expect(parseSectionField("Shrestha")).toEqual({
      kind: "people",
      people: [{ surnameTokens: ["shrestha"], firstTokens: [], suffix: null }],
    });
  });

  test("accents fold before parsing, so accented and plain fields parse the same", () => {
    expect(parseSectionField("Muñoz-Coreas,Edgard Ennio")).toEqual(parseSectionField("Munoz-Coreas,Edgard Ennio"));
  });
});
