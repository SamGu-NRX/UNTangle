import { syntheticPdf, transcriptLines } from "./pdf";
const style = "<style>body{font:16px/1.5 Georgia;margin:30px;color:#222}header{background:#00512b;color:white;padding:16px}table{border-collapse:collapse}td,th{padding:12px;border:1px solid #aaa;text-align:left}a,button{font:inherit}a{color:#00512b}</style>";
function html(body: string) { return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Mock myUNT</title>${style}<header>myUNT • Synthetic local fixture</header>${body}</html>`, { headers: { "Content-Type": "text/html" } }); }
const server = Bun.serve({ hostname: "localhost", port: 4317, fetch(req) {
  const url = new URL(req.url);
  if (url.pathname === "/health") return new Response("ok");
  if (url.pathname === "/synthetic-transcript.pdf") return new Response(syntheticPdf(), { headers: { "Content-Type": "application/pdf" } });
  if (url.pathname === "/transcript-entry") return html('<h1>View Unofficial Transcript</h1><p>Choose your report.</p><a href="/transcript-report">Submit and View Report</a>');
  if (url.pathname === "/transcript-report") return html(`<h1>View Unofficial Transcript</h1><p>Academic Records → View Unofficial Transcript → Submit → View Report</p>${url.searchParams.has("rendered") ? `<pre id="transcript-report" data-transcript-report>${transcriptLines.join("\n")}</pre>` : '<a href="/synthetic-transcript.pdf" target="_blank">View Report PDF</a>'}`);
  if (url.pathname === "/class-search") return html('<h1>Class search results</h1><table><thead><tr><th>Course</th><th>Section</th><th>Days</th><th>Times</th><th>Room</th><th>Instructor</th><th>Status</th></tr></thead><tbody><tr><td>CSCE 1030</td><td>001</td><td>MWF</td><td>10:00 AM - 10:50 AM</td><td>Discovery Park B155</td><td>Example Instructor</td><td>Open</td></tr><tr hidden><td>CSCE 1040</td><td>002</td><td>TR</td><td>11:00 AM</td><td>B100</td><td>Hidden Instructor</td><td>Closed</td></tr></tbody></table>');
  return new Response("Not found", { status: 404 });
} });
console.log(`Mock myUNT: ${server.url}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { server.stop(true); process.exit(0); });
