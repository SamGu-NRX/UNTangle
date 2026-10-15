// Values match frontend/src/app/globals.css (tests/extension.test.ts checks
// each one). Shadow roots cannot inherit the app stylesheet, so the extension
// imports this subset explicitly.
export const extensionTokens = `
  --paper: #ffffff; --paper-2: #eef2ed; --paper-3: #e5ebe4; --ink: #1a2e1a; --ink-2: #4f654f; --ink-3: #6b806b;
  --brand: #00512b; --brand-2: #007a40; --brand-soft: #e3efe6; --line: #dde6dc; --line-2: #c5d3c4;
  --danger: #b3261e; --danger-soft: #fbeae8; --attention: #8a6100; --attention-soft: #fbf3df;
  --accent: #00a855; --accent-soft: #dff5e8;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 20px; --s6: 24px; --s8: 32px;
  --r-xs: 4px; --r-sm: 8px; --r-md: 12px; --r-pill: 999px;
  --text-label: 11px; --lh-label: 16px; --text-meta: 13px; --lh-meta: 18px;
  --text-body: 14px; --lh-body: 20px; --text-title: 18px; --lh-title: 24px;
  --shadow-1: 0 1px 2px rgba(20, 40, 22, .07);
  --ease-out: cubic-bezier(.23, 1, .32, 1);
  --t-press: 120ms; --t-swap: 160ms; --t-enter: 220ms;
  --focus: 0 0 0 2px var(--paper), 0 0 0 4px var(--accent);
  --font-ui: "DM Sans", ui-sans-serif, sans-serif;
  --font-mark: "Syne", "DM Sans", sans-serif;
`;
