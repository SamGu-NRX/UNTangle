import { parseVsbTerm, SectionSchemaError } from "./vsb";
export function parseVsbSubject(value: unknown, term: string, subject: string) {
  // Proposed Dylan contract: the same v2 envelope, with courses for one subject.
  // Reject other formats until the published subject schema is verified.
  const data = parseVsbTerm(value, term);
  if ([...data.courses.keys()].some(code => !code.startsWith(`${subject} `))) throw new SectionSchemaError("$.courses", `expected only ${subject} courses in subject file`);
  return data;
}
