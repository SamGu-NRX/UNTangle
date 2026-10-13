/**
 * Choosing the downloaded transcript. Where the File System Access picker
 * exists (desktop Chromium) it opens in Downloads, where myUNT's PDF lands.
 * Everywhere else (Safari, Firefox, phones) the caller clicks a plain
 * `<input type="file">` instead, synchronously in the same click, since
 * Safari only opens a file input from inside the user's gesture.
 */

/** Options for showOpenFilePicker: one PDF, starting in Downloads. */
export const PDF_PICKER_OPTIONS = {
  startIn: "downloads",
  types: [{ description: "Transcript PDF", accept: { "application/pdf": [".pdf"] } }],
  excludeAcceptAllOption: true,
  multiple: false,
} as const;

type FileHandle = { getFile(): Promise<File> };
type ShowOpenFilePicker = (options: typeof PDF_PICKER_OPTIONS) => Promise<FileHandle[]>;

/** TypeScript's DOM types don't include the File System Access API yet. */
export type PickerHost = { showOpenFilePicker?: ShowOpenFilePicker };

export function filePicker(host: PickerHost): ShowOpenFilePicker | null {
  return typeof host.showOpenFilePicker === "function" ? host.showOpenFilePicker.bind(host) : null;
}

export type PickResult =
  | { kind: "file"; file: File }
  /** The person closed the picker: say nothing. */
  | { kind: "cancelled" }
  /** The picker refused (e.g. inside a cross-origin frame): use the file input. */
  | { kind: "fallback" };

export async function pickPdf(show: ShowOpenFilePicker): Promise<PickResult> {
  try {
    const [handle] = await show(PDF_PICKER_OPTIONS);
    return handle ? { kind: "file", file: await handle.getFile() } : { kind: "cancelled" };
  } catch (error) {
    return isAbort(error) ? { kind: "cancelled" } : { kind: "fallback" };
  }
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}
