import { describe, expect, test } from "bun:test";
import { CONFIDENCE_THRESHOLD, matchInstructor, type Candidate } from "../../src/lib/instructors/match";
import { HISTORY_UNIVERSE } from "./data/identities";

const candidateOf = (firstName: string, lastName: string): Candidate => ({
  id: JSON.stringify([firstName, lastName]),
  name: `${firstName} ${lastName}`,
  firstName,
  lastName,
});

const JOHN_SMITH = candidateOf("John", "Smith");
const JANE_SMITH = candidateOf("Jane", "Smith");
const ANTHONY_CURRAN = candidateOf("Anthony A", "Curran");
const DAN_KIM = candidateOf("Dan", "Kim");
const DAN_J_KIM = candidateOf("Dan J.", "Kim");

describe("unusable section instructors", () => {
  test("Staff, TBA, Closed, None and blank abstain with the placeholder named", () => {
    for (const [name, word] of [
      ["Staff", "staff"],
      ["TBA", "tba"],
      ["Closed", "closed"],
      ["None", "none"],
      ["None None", "none"],
      ["", "blank"],
      ["   ", "blank"],
    ] as const) {
      const result = matchInstructor(name, HISTORY_UNIVERSE);
      expect(result.candidateId).toBeNull();
      expect(result.confidence).toBe(0);
      expect(result.reason).toBe(`section instructor is ${word}`);
    }
  });

  test("placeholders abstain regardless of the candidate list", () => {
    const result = matchInstructor("TBA", [JOHN_SMITH]);
    expect(result.candidateId).toBeNull();
  });
});

describe("the surname gate", () => {
  test("identical first names do not match without a surname overlap", () => {
    const result = matchInstructor("Amini salehi,Mohsen", [candidateOf("Mohsen", "Riahi alam")]);
    expect(result.candidateId).toBeNull();
    expect(result.reason).toBe("no candidate shares the section surname");
  });

  test("hyphenated, spaced and reordered compound surnames are one token set", () => {
    const garciaLopez = candidateOf("Juan", "Garcia-Lopez");
    expect(matchInstructor("Garcia Lopez,Juan", [garciaLopez]).candidateId).toBe(garciaLopez.id);
    expect(matchInstructor("Lopez Garcia,Juan", [garciaLopez]).candidateId).toBe(garciaLopez.id);
    expect(matchInstructor("Garcia-Lopez,Juan", [garciaLopez]).candidateId).toBe(garciaLopez.id);
  });

  test("apostrophes and case fold away", () => {
    const obrien = candidateOf("Sean", "O'Brien");
    expect(matchInstructor("OBrien,Sean", [obrien]).candidateId).toBe(obrien.id);
    expect(matchInstructor("obrien,sean", [obrien]).candidateId).toBe(obrien.id);
  });

  test("accents fold through the explicit map in both directions", () => {
    const munoz = candidateOf("Edgard Ennio", "Munoz-Coreas");
    expect(matchInstructor("Muñoz-Coreas,Edgard Ennio", [munoz]).candidateId).toBe(munoz.id);
  });
});

describe("first names and initials", () => {
  test("a consistent single initial is enough with a surname", () => {
    const result = matchInstructor("Smith,J", [JOHN_SMITH]);
    expect(result.candidateId).toBe(JOHN_SMITH.id);
    expect(result.reason).toBe("matched on surname and first-name initial");
    expect(result.confidence).toBe(CONFIDENCE_THRESHOLD);
  });

  test("an initial that fits no candidate never matches on surname alone", () => {
    const result = matchInstructor("Smith,T", [JANE_SMITH]);
    expect(result.candidateId).toBeNull();
    expect(result.reason).toBe("section surname matches but the first name does not");
  });

  test("surname-only section fields abstain even against a real candidate", () => {
    const result = matchInstructor("Smith", [JOHN_SMITH]);
    expect(result.candidateId).toBeNull();
    expect(result.reason).toBe("section surname matches but first-name evidence is insufficient");
  });

  test("compound first names compare token by token", () => {
    const result = matchInstructor("Shrestha,Pradhumna Lal", [candidateOf("Pradhumna Lal", "Shrestha")]);
    expect(result.candidateId).toBe(JSON.stringify(["Pradhumna Lal", "Shrestha"]));
    expect(result.reason).toBe("matched on surname and full first name");
    expect(result.confidence).toBe(1);
  });
});

describe("middle names", () => {
  test("a middle token both sides carry must agree", () => {
    const result = matchInstructor("Shrestha,Pradhumna X", [candidateOf("Pradhumna Lal", "Shrestha")]);
    expect(result.candidateId).toBeNull();
    expect(result.reason).toBe("section surname matches but the first name does not");
  });

  test("a middle present on only one side is unknown, not a contradiction", () => {
    expect(matchInstructor("Kim,Dan J.", [DAN_KIM]).candidateId).toBe(DAN_KIM.id);
    expect(matchInstructor("Kim,Dan", [DAN_J_KIM]).candidateId).toBe(DAN_J_KIM.id);
    expect(matchInstructor("Kim,Dan J.", [DAN_J_KIM]).candidateId).toBe(DAN_J_KIM.id);
  });
});

describe("suffixes", () => {
  test("a suffix in the surname slot strips, so Curran Jr matches Anthony A Curran", () => {
    const result = matchInstructor("Curran Jr,Anthony A", [ANTHONY_CURRAN]);
    expect(result.candidateId).toBe(ANTHONY_CURRAN.id);
  });

  test("a trailing display-form suffix strips too", () => {
    expect(matchInstructor("Anthony A Curran Jr", [ANTHONY_CURRAN]).candidateId).toBe(ANTHONY_CURRAN.id);
  });
});

describe("shared surnames", () => {
  const shresthas = [candidateOf("Pradhumna Lal", "Shrestha"), candidateOf("Binod", "Shrestha")];

  test("full first-name evidence separates exactly one candidate", () => {
    expect(matchInstructor("Shrestha,Pradhumna Lal", shresthas).candidateId).toBe(
      JSON.stringify(["Pradhumna Lal", "Shrestha"]),
    );
    expect(matchInstructor("Shrestha,Binod", shresthas).candidateId).toBe(JSON.stringify(["Binod", "Shrestha"]));
  });

  test("an initial consistent with two candidates abstains", () => {
    const result = matchInstructor("Shrestha,P", [candidateOf("Pradhumna Lal", "Shrestha"), candidateOf("Paul", "Shrestha")]);
    expect(result.candidateId).toBeNull();
    expect(result.reason).toBe("ambiguous: several candidates match the section name");
  });

  test("identical full names on two candidates abstain", () => {
    const dupe = { ...JOHN_SMITH, id: "duplicate id" };
    const result = matchInstructor("Smith,John", [JOHN_SMITH, dupe]);
    expect(result.candidateId).toBeNull();
    expect(result.reason).toBe("ambiguous: several candidates match the section name");
  });
});

describe("several people in one field", () => {
  test("two people matching two candidates abstain", () => {
    const result = matchInstructor("Smith,John, Smith,Jane", [JOHN_SMITH, JANE_SMITH]);
    expect(result.candidateId).toBeNull();
    expect(result.reason).toBe("ambiguous: the section field matches several people");
  });

  test("exactly one person matching exactly one candidate still matches", () => {
    const result = matchInstructor("Stranger,Alice, Smith,John", [JOHN_SMITH, JANE_SMITH]);
    expect(result.candidateId).toBe(JOHN_SMITH.id);
    expect(result.reason).not.toContain("ambiguous");
  });

  test("a repeated identical person dedupes to one match", () => {
    const result = matchInstructor("Smith,John, Smith,John", [JOHN_SMITH, JANE_SMITH]);
    expect(result.candidateId).toBe(JOHN_SMITH.id);
  });

  test("a team that merely contains a similar name does not match a different candidate", () => {
    const haili = candidateOf("Haili", "Wang");
    const result = matchInstructor(
      "Nestler,Eric M, Peterson,Mikayla Lisa, Li,Jinkai, Montgomery,Cameron Hunter, Wang,Xuanzhou",
      [haili],
    );
    expect(result.candidateId).toBeNull();
  });
});

describe("display form", () => {
  test("the First Last display form matches the same person as its raw pair", () => {
    expect(matchInstructor("John Smith", [JOHN_SMITH]).candidateId).toBe(JOHN_SMITH.id);
    expect(matchInstructor("Anthony A Curran Jr", [ANTHONY_CURRAN]).candidateId).toBe(ANTHONY_CURRAN.id);
  });

  test("display-form teams split on semicolons", () => {
    const result = matchInstructor("John Smith; Jane Smith", [JOHN_SMITH, JANE_SMITH]);
    expect(result.candidateId).toBeNull();
  });
});

describe("contract edges", () => {
  test("the threshold stays at 0.9 and abstains report zero confidence", () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.9);
    const abstained = matchInstructor("Smith,T", [JANE_SMITH]);
    expect(abstained.confidence).toBe(0);
  });

  test("garbage input never throws and always abstains", () => {
    for (const garbage of ["!!!", ",,,", "Smith,John, Doe", "   ,,,  "]) {
      const result = matchInstructor(garbage, HISTORY_UNIVERSE);
      expect(result.candidateId).toBeNull();
      expect(result.confidence).toBe(0);
    }
  });

  test("reasons are stable phrases without mid dots", () => {
    for (const sectionName of ["TBA", "Smith,John", "Smith,J", "Smith,John, Smith,Jane"]) {
      const result = matchInstructor(sectionName, HISTORY_UNIVERSE);
      expect(result.reason).not.toContain("·");
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.reason).toBe(result.reason.trim());
    }
  });

  test("the matcher is deterministic across repeated calls", () => {
    const first = matchInstructor("Shrestha,Pradhumna Lal", HISTORY_UNIVERSE);
    const second = matchInstructor("Shrestha,Pradhumna Lal", HISTORY_UNIVERSE);
    expect(second).toEqual(first);
  });
});
