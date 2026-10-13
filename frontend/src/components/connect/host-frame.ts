/**
 * What the Connect host decides once per opening: the container (dialog or
 * bottom sheet) and whether the sheet restores a myUNT trip.
 *
 * Both hold until the sheet closes. Swapping the container when the window
 * crosses the 719px breakpoint (a phone rotating, a desktop zooming) would
 * remount the sheet and throw away a parse in progress or the rows already
 * approved. After closing, the old frame is kept so the exit animation runs
 * in the container it opened in.
 */
export type Frame = { open: boolean; phone: boolean; restoreTrip: boolean };

export const CLOSED_FRAME: Frame = { open: false, phone: false, restoreTrip: false };

export function nextFrame(
  frame: Frame,
  open: boolean,
  isPhone: boolean,
  readTripFlag: () => boolean,
): Frame {
  if (open === frame.open) return frame;
  if (!open) return { ...frame, open: false };
  return { open: true, phone: isPhone, restoreTrip: readTripFlag() };
}
