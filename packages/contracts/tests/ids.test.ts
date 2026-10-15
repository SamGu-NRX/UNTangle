import { describe, expect, expectTypeOf, test } from "bun:test";
import {
  CourseIdSchema,
  DocumentIdSchema,
  InstitutionIdSchema,
  OperationIdSchema,
  TermIdSchema,
  type CourseId,
  type DocumentId,
  type InstitutionId,
  type OperationId,
  type TermId,
} from "../src/ids";

describe("InstitutionId", () => {
  test.each(["unt", "ut-austin"])("accepts %p", (value) => {
    expect(InstitutionIdSchema.safeParse(value).success).toBe(true);
  });
  test.each(["UNT", "unt ", "", "unt--frisco", "-unt", "unt_denton", "a".repeat(65)])("rejects %p", (value) => {
    expect(InstitutionIdSchema.safeParse(value).success).toBe(false);
  });
});

describe("TermId", () => {
  test.each(["spring-2027", "fall-2026", "summer-2027"])("accepts %p", (value) => {
    expect(TermIdSchema.safeParse(value).success).toBe(true);
  });
  test.each(["Spring 2027", "2027 Spring", "spring_2027", ""])("rejects %p", (value) => {
    expect(TermIdSchema.safeParse(value).success).toBe(false);
  });
});

describe("CourseId", () => {
  test.each(["CSCE 1030", "MATH 1680", "BIOL 1710L", "C S 312"])("accepts %p", (value) => {
    expect(CourseIdSchema.safeParse(value).success).toBe(true);
  });
  test.each([" CSCE 1030", "CSCE 1030 ", "CSCE  1030", "CSCE\t1030", "CSCE\n1030", "", "X".repeat(33)])(
    "rejects %p",
    (value) => {
      expect(CourseIdSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("document and operation ids", () => {
  test.each([DocumentIdSchema, OperationIdSchema])("accept a UUID and reject a path or an empty id", (schema) => {
    expect(schema.safeParse("0b6b5c1e-8f0a-4c4e-9d43-3f1b0f9a2c11").success).toBe(true);
    expect(schema.safeParse("../other-user").success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
    expect(schema.safeParse("a".repeat(129)).success).toBe(false);
  });
});

describe("parsed ids keep their kind in the type system", () => {
  test("each schema returns its own brand", () => {
    expectTypeOf(InstitutionIdSchema.parse("unt")).toEqualTypeOf<InstitutionId>();
    expectTypeOf(TermIdSchema.parse("spring-2027")).toEqualTypeOf<TermId>();
    expectTypeOf(CourseIdSchema.parse("CSCE 1030")).toEqualTypeOf<CourseId>();
    expectTypeOf(DocumentIdSchema.parse("schedule-main")).toEqualTypeOf<DocumentId>();
    expectTypeOf(OperationIdSchema.parse("op-1")).toEqualTypeOf<OperationId>();
  });

  test("a document id can't be used as an operation id", () => {
    const documentId = DocumentIdSchema.parse("schedule-main");
    // @ts-expect-error A write's operation id is not its document id.
    const operationId: OperationId = documentId;
    expect<string>(operationId).toBe("schedule-main");
  });

  test("one kind of id can't stand in for another, or for a bare string", () => {
    const term = TermIdSchema.parse("spring-2027");
    // @ts-expect-error A term id is not an institution id.
    const institution: InstitutionId = term;
    // @ts-expect-error A string has to be parsed before it is a course id.
    const course: CourseId = "CSCE 1030";
    // Both are still the plain strings that were parsed.
    expect<string[]>([institution, course]).toEqual(["spring-2027", "CSCE 1030"]);
  });
});
