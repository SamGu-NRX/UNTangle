/** An explicit 3D choice overrides the opening camera, except under reduced motion. */
export function dayTilt({ automatic, choice, reducedMotion }: {
  automatic: boolean;
  choice: boolean | null;
  reducedMotion: boolean;
}): boolean {
  return !reducedMotion && (choice ?? automatic);
}
