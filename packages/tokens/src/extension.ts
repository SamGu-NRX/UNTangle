// Values match frontend/src/app/globals.css. Shadow roots cannot inherit
// the app stylesheet, so the extension imports this subset explicitly.
export const extensionTokens = `
  --paper: #ffffff; --paper-2: #eef2ed; --ink: #1a2e1a; --ink-2: #4f654f;
  --brand: #00512b; --line: #dde6dc; --danger: #b3261e; --attention: #8a6100;
  --accent: #00a855; --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s6: 24px;
  --r-sm: 8px; --text-body: 14px; --text-title: 18px;
  --font-ui: "DM Sans", ui-sans-serif, sans-serif;
`;
