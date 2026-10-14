// A stand-in for myUNT's unofficial transcript page, for local journeys: the
// page the "Open myUNT" window shows, and the synthetic PDF it links to.
import { syntheticPdf } from "./pdf";
import { buildClassSearchHtml } from "./class-search-fixture";
const style =
  "<style>body{font:16px/1.5 Georgia;margin:30px;color:#222}header{background:#00512b;color:white;padding:16px}a{color:#00512b}</style>";
function html(body: string) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Mock myUNT</title>${style}<header>myUNT • Synthetic local fixture</header>${body}</html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}
const server = Bun.serve({
  hostname: "localhost",
  port: 4317,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/synthetic-transcript.pdf")
      return new Response(syntheticPdf(), {
        headers: { "Content-Type": "application/pdf" },
      });
    if (url.pathname === "/transcript")
      return html(
        '<h1>View Unofficial Transcript</h1><p>Academic Records → View Unofficial Transcript → View as PDF</p><a href="/synthetic-transcript.pdf" download="unofficial-transcript.pdf">Download PDF</a>',
      );
    return new Response("Not found", { status: 404 });
  },
});
console.log(`Mock myUNT: ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.stop(true);
    process.exit(0);
  });
