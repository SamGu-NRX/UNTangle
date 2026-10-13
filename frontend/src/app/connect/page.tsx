import type { Metadata } from "next";

export const metadata: Metadata = { title: "Import from myUNT" };

/**
 * /connect draws no page of its own: the app shell's ConnectHost opens the
 * Connect sheet whenever the URL is /connect, over whatever view was showing
 * (or over this empty page on a direct visit or reload).
 */
export default function ConnectPage() {
  return null;
}
