import { describe, expect, test } from "bun:test";
import {
  acceptsResponse,
  parseMessage,
  request,
  response,
  MAX_PDF_BYTES,
  validPayload,
} from "../../src/lib/connect/protocol";
import { allowedPdfUrl, pageKind } from "../../../extension/src/config";
const nonce = "11111111-1111-4111-8111-111111111111";
const reply = response(nonce, {
  type: "capabilities",
  resources: ["transcript", "sections"],
});
describe("connect protocol boundary", () => {
  test("accepts each versioned message shape", () => {
    const messages = [
      request(nonce, { type: "hello" }),
      request(nonce, { type: "request", resource: "transcript" }),
      request(nonce, { type: "cancel" }),
      reply,
      response(nonce, { type: "progress", stage: "reading" }),
      response(nonce, { type: "error", reason: "NO_REPORT" }),
      response(nonce, {
        type: "result",
        payload: { kind: "pdf", base64: "JVBERi0xLjQK" },
      }),
    ];
    for (const message of messages)
      expect(parseMessage(message)).toEqual(message);
  });
  test("ignores stale nonces, other windows, wrong origins, and app echoes", () => {
    const source = {} as Window;
    const event = { source, origin: "http://localhost:3000", data: reply };
    expect(acceptsResponse(event, source, event.origin, nonce)).toEqual(reply);
    expect(
      acceptsResponse(event, source, "https://evil.example", nonce),
    ).toBeNull();
    expect(acceptsResponse(event, {}, event.origin, nonce)).toBeNull();
    expect(
      acceptsResponse(event, source, event.origin, crypto.randomUUID()),
    ).toBeNull();
    expect(
      acceptsResponse(
        { ...event, data: request(nonce, { type: "hello" }) },
        source,
        event.origin,
        nonce,
      ),
    ).toBeNull();
  });
  test("rejects unknown versions, resources, reasons and malformed payloads", () => {
    for (const invalid of [
      null,
      {},
      { ...reply, version: 2 },
      { ...reply, nonce: "short" },
      { ...reply, resources: ["cookies"] },
      { ...reply, type: "error", reason: "GUESS" },
    ])
      expect(parseMessage(invalid)).toBeNull();
    for (const invalid of [
      { kind: "pdf", base64: "not!pdf!" },
      { kind: "pdf", base64: "A".repeat(Math.ceil(MAX_PDF_BYTES / 3) * 4 + 4) },
      { kind: "transcript-text", text: " " },
      { kind: "sections", rows: [{ course: "CSCE 1030" }] },
    ])
      expect(validPayload(invalid)).toBe(false);
  });
  test("only recognizes configured portal paths and dev-only mock", () => {
    expect(
      pageKind(
        "https://my.unt.edu/psc/ps/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_SSENRL_TRN.GBL",
        false,
      ),
    ).toBe("transcript");
    expect(pageKind("https://my.unt.edu/login", true)).toBeNull();
    expect(
      pageKind("https://my.unt.edu.evil.example/psreports/report.pdf", false),
    ).toBeNull();
    expect(
      pageKind("http://localhost:4317/transcript-report", false),
    ).toBeNull();
    expect(pageKind("http://localhost:4317/transcript-report", true)).toBe(
      "transcript",
    );
    expect(pageKind("http://localhost:4317/class-search", true)).toBe(
      "sections",
    );
  });
  test("rejects arbitrary, cross-origin, login, and credential-bearing downloads", () => {
    const page = "https://my.unt.edu/psreports/report.html";
    expect(allowedPdfUrl("/psreports/report.pdf", page, false)).toBe(true);
    for (const url of [
      "https://evil.example/report.pdf",
      "https://user:pass@my.unt.edu/psreports/report.pdf",
      "/login",
      "javascript:alert(1)",
    ])
      expect(allowedPdfUrl(url, page, false)).toBe(false);
    expect(
      allowedPdfUrl(
        "/synthetic-transcript.pdf",
        "http://localhost:4317/transcript-report",
        true,
      ),
    ).toBe(true);
  });
});
