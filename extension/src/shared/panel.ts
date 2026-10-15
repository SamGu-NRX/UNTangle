import type { Preview, SectionRef } from "./extension-api";
export interface PanelPreview {
  previewId: string;
  ref: SectionRef;
  preview: Preview;
}
export interface PanelState {
  signedIn: boolean;
  preview: PanelPreview | null;
  notice: string;
  pending: number;
}
