import type { GradeData } from "@/lib/grades";

const configuredBackendUrl = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL;
const backendBaseUrls = configuredBackendUrl
  ? [configuredBackendUrl]
  : [
      "http://localhost:3001",
      "http://127.0.0.1:3001",
      "http://localhost:3002",
      "http://127.0.0.1:3002",
      "http://localhost:3011",
      "http://127.0.0.1:3011",
    ];

export type GradeInstructor = {
  firstName: string | null;
  id: number;
  lastName: string | null;
  name: string;
  rmpDepartment: string | null;
  rmpDifficulty: number | null;
  rmpNumRatings: number | null;
  rmpProfileUrl: string | null;
  rmpRating: number | null;
  rmpSource: string | null;
  rmpTags: Array<{
    tagCount: number;
    tagName: string;
  }>;
  rmpUpdatedAt: string | null;
  rmpWouldTakeAgain: number | null;
};

export type GradeSection = {
  course: {
    id: number;
    number: string;
    subject: string;
    title: string;
  };
  gpa: number | null;
  grades: GradeData;
  id: number;
  instructor: GradeInstructor;
  otherGrades: Record<string, number>;
  sectionNumber: string;
  term: string;
  title: string;
};

export type CourseGradeDetail = {
  aggregate: {
    gpa: number | null;
    grades: GradeData;
  };
  course: {
    credits: number;
    description: string | null;
    id: number;
    number: string;
    subject: string;
    title: string;
  };
  instructors: Array<GradeInstructor & {
    gpa: number | null;
    sectionCount: number;
    totalEnroll: number;
  }>;
  sections: GradeSection[];
  terms: string[];
};

export type InstructorGradeDetail = {
  aggregate: {
    gpa: number | null;
    grades: GradeData;
  };
  courseGroups: Array<{
    course: {
      id: number;
      number: string;
      subject: string;
      title: string;
    };
    gpa: number | null;
    grades: GradeData;
    sectionCount: number;
    sections: GradeSection[];
    totalEnroll: number;
  }>;
  instructor: GradeInstructor;
  sections: GradeSection[];
  terms: string[];
};

async function backendFetch<T>(path: string): Promise<T | null> {
  const errors: string[] = [];

  for (const baseUrl of backendBaseUrls) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        cache: "no-store",
      });

      if (response.status === 404) {
        if (response.headers.get("x-powered-by") === "Next.js") {
          errors.push(`${baseUrl} returned a Next.js 404`);
          continue;
        }
        return null;
      }

      if (!response.ok) {
        throw new Error(`${baseUrl} responded with ${response.status}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${baseUrl}: ${message}`);
    }
  }

  console.error(`Backend fetch failed for ${path}. Tried: ${errors.join("; ")}`);
  return null;
}

export function getCourseGradeDetail(subject: string, number: string) {
  return backendFetch<CourseGradeDetail>(
    `/api/grades/courses/${encodeURIComponent(subject)}/${encodeURIComponent(number)}`,
  );
}

export function getInstructorGradeDetail(id: string) {
  return backendFetch<InstructorGradeDetail>(`/api/grades/instructors/${encodeURIComponent(id)}`);
}
