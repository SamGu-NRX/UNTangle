import { describe, expect, test } from "bun:test";
import { extractSyllabusFacts, splitSentences } from "../../src/lib/syllabus/extract";

/**
 * The extractor quotes evidence and refuses to guess. These tests pin both
 * halves: quotes must slice back to their own offsets, and a missing fact
 * must come back as not found rather than as a plausible default.
 */

function expectValidSource(source: { quote: string; start: number; end: number }, text: string): void {
  expect(source.end).toBeGreaterThan(source.start);
  expect(text.slice(source.start, source.end)).toBe(source.quote);
}

describe("splitSentences", () => {
  test("keeps offsets that slice back to the sentence", () => {
    const text = "Attendance is required. You may be dropped after three unexcused absences.";
    const sentences = splitSentences(text);
    expect(sentences).toHaveLength(2);
    for (const sentence of sentences) {
      expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
    }
  });

  test("splits after multiple spaces or tabs while preserving every source", () => {
    for (const separator of ["  ", "\t ", " \t\t "]) {
      const text = `Attendance is required daily.${separator}There will be three exams.`;
      const sentences = splitSentences(text);
      expect(sentences.map((sentence) => sentence.text)).toEqual([
        "Attendance is required daily.", "There will be three exams.",
      ]);
      for (const sentence of sentences) expect(text.slice(sentence.start, sentence.end)).toBe(sentence.text);
      const facts = extractSyllabusFacts(text);
      expect(facts.attendancePolicy.found).toBe(true);
      expect(facts.examCount.found).toBe(true);
      if (facts.attendancePolicy.found) expect(facts.attendancePolicy.source.quote).toBe("Attendance is required daily.");
      if (facts.examCount.found) expect(facts.examCount.source.quote).toBe("There will be three exams.");
    }
  });

  test("does not split an abbreviation before a lowercase continuation", () => {
    const text = "The instructor, e.g. Dr. Smith, takes attendance daily.";
    const sentences = splitSentences(text);
    expect(sentences).toHaveLength(1);
    expect(sentences[0].text).toBe(text.trim());
  });
});

describe("attendancePolicy", () => {
  test("quotes a stated attendance requirement with its offsets", () => {
    const text =
      "Course materials are on Canvas. Attendance is required and will be taken each class meeting. Grades are posted weekly.";
    const facts = extractSyllabusFacts(text);
    expect(facts.attendancePolicy.found).toBe(true);
    if (facts.attendancePolicy.found) {
      expect(facts.attendancePolicy.source.quote).toBe("Attendance is required and will be taken each class meeting.");
      expectValidSource(facts.attendancePolicy.source, text);
    }
  });

  test("prefers the consequence sentence over a mention", () => {
    const text =
      "Attendance will be recorded. Students who miss more than three unexcused absences may be dropped from the course.";
    const facts = extractSyllabusFacts(text);
    expect(facts.attendancePolicy.found).toBe(true);
    if (facts.attendancePolicy.found) {
      expect(facts.attendancePolicy.source.quote).toContain("dropped");
      expectValidSource(facts.attendancePolicy.source, text);
    }
  });

  test("a bare heading is not a policy", () => {
    const text = "Attendance Policy\n\nChapter 5 covers attendance technologies used in class.";
    expect(extractSyllabusFacts(text).attendancePolicy.found).toBe(false);
  });

  test("no attendance sentence means not found, never a default", () => {
    const text = "The final exam is comprehensive. Laptops are allowed on quizzes.";
    const result = extractSyllabusFacts(text).attendancePolicy;
    expect(result.found).toBe(false);
    if (!result.found) expect(result.reason).toBeTruthy();
  });
});

describe("examCount", () => {
  test("reads a word-number total", () => {
    const text = "There will be three exams in this course, plus weekly homework.";
    const result = extractSyllabusFacts(text).examCount;
    expect(result.found).toBe(true);
    expect(result.count).toBe(3);
    if (result.found) expectValidSource(result.source, text);
  });

  test("reads a digit total", () => {
    const text = "You will have 4 exams and 10 homework assignments.";
    const result = extractSyllabusFacts(text).examCount;
    expect(result.found).toBe(true);
    expect(result.count).toBe(4);
  });

  test("sums an enumeration of midterms and a final", () => {
    const text = "Two midterm exams and one final exam are given during the term.";
    const result = extractSyllabusFacts(text).examCount;
    expect(result.found).toBe(true);
    expect(result.count).toBe(3);
  });

  test("a schedule row for Exam 1 is not a total", () => {
    const text = "Week 6: Exam 1 covers chapters 1 through 4.";
    const result = extractSyllabusFacts(text).examCount;
    expect(result.found).toBe(false);
  });

  test("an explicit total takes precedence over its breakdown", () => {
    for (const text of [
      "There are three exams: two midterms and one final.",
      "There will be three exams, including two midterm exams and one final exam.",
      "Two midterms and one final make three exams in total.",
    ]) {
      const result = extractSyllabusFacts(text).examCount;
      expect(result.count).toBe(3);
      if (result.found) expectValidSource(result.source, text);
    }
    expect(extractSyllabusFacts("Two midterm exams and one final exam are given during the term.").examCount.count).toBe(3);
  });

  test("week numbers and calendar dates are never exam totals", () => {
    for (const text of ["Week 16 Final Exam", "Week 9 Midterm Exam", "October 09, 2026 Midterm Exam", "10/09/2026 Midterm Exam", "10-09 Final Exam"]) {
      expect(extractSyllabusFacts(text).examCount.found).toBe(false);
    }
    const text = "Week 16 Final Exam\nThere will be three exams in this course.";
    const result = extractSyllabusFacts(text).examCount;
    expect(result.found).toBe(true);
    expect(result.count).toBe(3);
    if (result.found) expect(result.source.quote).toBe("There will be three exams in this course.");
  });

  test("explicit totals survive a date or week suffix without changing their quote", () => {
    for (const text of [
      "There will be three exams on September 1, October 1, and December 1.",
      "There will be three exams starting in Week 4.",
      "You will have 3 exams starting on 10/09/2026.",
    ]) {
      const result = extractSyllabusFacts(text).examCount;
      expect(result.found).toBe(true);
      expect(result.count).toBe(3);
      if (result.found) {
        expect(result.source.quote).toBe(text);
        expectValidSource(result.source, text);
      }
    }
  });

  test("no stated count stays not found", () => {
    const text = "The final exam is comprehensive and closed book.";
    expect(extractSyllabusFacts(text).examCount.found).toBe(false);
  });
});

describe("gradingWeights", () => {
  test("reads a one-line grading breakdown", () => {
    const text = "Grading: Exams 60%, Homework 25%, Participation 15%. Attendance is extra credit.";
    const result = extractSyllabusFacts(text).gradingWeights;
    expect(result.found).toBe(true);
    if (result.found) {
      expect(result.components.map((c) => [c.name, c.weightPct])).toEqual([
        ["Exams", 60],
        ["Homework", 25],
        ["Participation", 15],
      ]);
      expectValidSource(result.source, text);
      for (const component of result.components) expectValidSource(component.source, text);
    }
  });

  test("a percent without a grading context is not weights", () => {
    const text = "You need 60% on the final to pass the course.";
    expect(extractSyllabusFacts(text).gradingWeights.found).toBe(false);
  });

  test("weights that cannot sum to 100 are not asserted", () => {
    const text = "Grading is holistic; roughly 30% homework and 20% quizzes with the rest flexible.";
    expect(extractSyllabusFacts(text).gradingWeights.found).toBe(false);
  });

  test("no weights at all means not found", () => {
    const text = "Grading is based on demonstrated understanding across the semester.";
    expect(extractSyllabusFacts(text).gradingWeights.found).toBe(false);
  });
});

describe("realistic syllabus text", () => {
  const text = [
    "CSCE 3201 Applied Artificial Intelligence",
    "Instructor: Dr. Ryan Garlick",
    "Course Description",
    "We study search, knowledge representation, and machine learning.",
    "Course Policies",
    "Attendance is expected; students with more than three unexcused absences may have their final grade lowered.",
    "Assessments",
    "There will be 3 exams including the final. Homework is assigned weekly.",
    "Grading",
    "Exams 60%, Homework 30%, Participation 10%.",
    "The final exam schedule is posted by the registrar.",
  ].join("\n");

  test("finds all three facts with sliceable offsets", () => {
    const facts = extractSyllabusFacts(text);
    expect(facts.attendancePolicy.found).toBe(true);
    expect(facts.examCount.found).toBe(true);
    expect(facts.examCount.count).toBe(3);
    expect(facts.gradingWeights.found).toBe(true);
    if (facts.gradingWeights.found) {
      const total = facts.gradingWeights.components.reduce((sum, c) => sum + c.weightPct, 0);
      expect(total).toBe(100);
    }
    if (facts.attendancePolicy.found) expectValidSource(facts.attendancePolicy.source, text);
    if (facts.examCount.found) expectValidSource(facts.examCount.source, text);
    if (facts.gradingWeights.found) {
      expectValidSource(facts.gradingWeights.source, text);
      for (const component of facts.gradingWeights.components) expectValidSource(component.source, text);
    }
  });

  test("the exam quote is the totals sentence, not the schedule line", () => {
    const facts = extractSyllabusFacts(text);
    if (facts.examCount.found) {
      expect(facts.examCount.source.quote).toContain("There will be 3 exams");
      expect(facts.examCount.source.quote).not.toContain("registrar");
    }
  });
});
