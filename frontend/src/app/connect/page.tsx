import type { Metadata, Viewport } from "next";
import { ConnectSheet } from "@/components/connect/connect-sheet";
export const metadata: Metadata = { title: "Connect myUNT · UNTangle" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function ConnectPage() { return <ConnectSheet />; }
