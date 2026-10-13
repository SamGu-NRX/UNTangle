export class SectionFileTooLargeError extends Error {
  constructor(limit: number) { super(`Direct vsb file exceeds ${limit} bytes; whole-term/oversized downloads are refused, use the proxy`); this.name = "SectionFileTooLargeError"; }
}
export async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > limit) {
    await response.body?.cancel();
    throw new SectionFileTooLargeError(limit);
  }
  if (!response.body) throw new Error("Direct vsb file has no response body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new SectionFileTooLargeError(limit); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
