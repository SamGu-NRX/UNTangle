import { redirect } from "next/navigation";

/** The import used to open over Courses here; it is the /connect page now. Kept for old links and bookmarks. */
export default function TranscriptImportRedirect() {
  redirect("/connect");
}
