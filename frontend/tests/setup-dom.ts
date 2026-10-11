// Registers a happy-dom global window for Testing Library component tests.
// Better Auth refuses to initialize from about:blank, so point the document at
// a localhost origin before any component imports the auth client.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!("window" in globalThis)) {
  GlobalRegistrator.register();
  window.location.href = "http://localhost:3100/";
}
