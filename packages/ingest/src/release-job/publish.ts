/**
 * Step 4 of "Reference data: published releases"
 * (docs/architecture/README.md), the local-disk half: write a complete
 * versioned release under a content-hash file name first, and flip the
 * pointer last.
 *
 * Today the sink is a local directory. Step 4's storage host for release
 * files and the Postgres pointer are later work; both implement
 * `ReleaseSink`, which is the seam this module leaves. `putContent` before
 * `putPointer` is the ordering that makes a pointer always name a complete
 * file, whatever fails and whenever it fails.
 *
 * Writes go to a temporary file and rename into place, so a reader never
 * sees a half-written file.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SectionRelease } from "../section-release";

/** Where a term's published release lives, as the app or a later job finds it. */
export type ReleasePointer = {
  sourceId: string;
  institutionId: string;
  termId: string;
  releaseId: string;
  contentSha256: string;
  rawSha256: string;
  parserVersion: string;
  /** The sink-relative content file the pointer names, e.g. `releases/<contentSha256>.json`. */
  file: string;
  /** When the pointer was flipped; never shown as "updated". */
  publishedAt: string;
};

export type ReleaseSink = {
  /** Writes the release under its content-hash name. Idempotent: an existing identical file is left alone. */
  putContent(release: SectionRelease): Promise<{ file: string; wrote: boolean }>;
  /** Flips the term's pointer to the release. Called only after putContent succeeded. */
  putPointer(release: SectionRelease, publishedAt: string): Promise<ReleasePointer>;
  /** The term's current pointer, or null when no release is published yet. */
  readPointer(termId: string): Promise<ReleasePointer | null>;
  /** Reads the release a pointer names, for comparing with the next candidate. */
  readContent(file: string): Promise<SectionRelease | null>;
};

/**
 * A directory holding one job's releases:
 *   <root>/releases/<contentSha256>.json   complete releases, content-hash names;
 *   <root>/pointers/<termId>.json          the pointer per term, written last;
 *   <root>/state.json                      the mirror's fetch state (separate from publishing).
 */
export function localSink(rootDir: string): ReleaseSink {
  const releasesDir = path.join(rootDir, "releases");
  const pointersDir = path.join(rootDir, "pointers");

  async function writeAtomic(file: string, contents: string): Promise<void> {
    const temporary = `${file}.tmp-${process.pid}`;
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, file);
  }

  return {
    async putContent(release) {
      const file = path.join("releases", `${release.manifest.contentSha256}.json`);
      const target = path.join(rootDir, file);
      let existing: string | null = null;
      try {
        existing = await readFile(target, "utf8");
      } catch {
        existing = null;
      }
      if (existing === null) {
        await mkdir(releasesDir, { recursive: true });
        await writeAtomic(target, JSON.stringify(release, null, 2));
        return { file, wrote: true };
      }
      // The hash names the courses content. Two releases under one hash must
      // agree on it; manifest metadata (fetchedAt, releaseId) may differ — a
      // refetch of unchanged content re-stamps the manifest, and that is fine.
      let existingCourses: unknown;
      try {
        existingCourses = (JSON.parse(existing) as { courses: unknown }).courses;
      } catch {
        existingCourses = undefined;
      }
      if (JSON.stringify(existingCourses) !== JSON.stringify(release.courses)) {
        throw new Error(`${file} exists with different content for the same hash`);
      }
      await writeAtomic(target, JSON.stringify(release, null, 2));
      return { file, wrote: true };
    },

    async putPointer(release, publishedAt) {
      const pointer: ReleasePointer = {
        sourceId: release.manifest.sourceId,
        institutionId: release.manifest.institutionId,
        termId: release.manifest.termId,
        releaseId: release.manifest.releaseId,
        contentSha256: release.manifest.contentSha256,
        rawSha256: release.manifest.rawSha256,
        parserVersion: release.manifest.parserVersion,
        file: path.join("releases", `${release.manifest.contentSha256}.json`),
        publishedAt,
      };
      await mkdir(pointersDir, { recursive: true });
      await writeAtomic(path.join(pointersDir, `${release.manifest.termId}.json`), JSON.stringify(pointer, null, 2));
      return pointer;
    },

    async readPointer(termId) {
      try {
        return JSON.parse(await readFile(path.join(pointersDir, `${termId}.json`), "utf8")) as ReleasePointer;
      } catch {
        return null;
      }
    },

    async readContent(file) {
      try {
        return JSON.parse(await readFile(path.join(rootDir, file), "utf8")) as SectionRelease;
      } catch {
        return null;
      }
    },
  };
}
