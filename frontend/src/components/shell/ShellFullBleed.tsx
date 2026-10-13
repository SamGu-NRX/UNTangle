import type { HTMLAttributes } from "react";

/**
 * A view body that fills the space between the top bar and the phone tabs
 * edge to edge, for views like the Map that must not scroll the page.
 *
 * It is the marker the shell's CSS looks for: any element carrying
 * `data-shell-body="full-bleed"` inside <main> gets this treatment, so a view
 * can also set the attribute on its own root. The shell then drops the page
 * margins (including NavShell's) and sizes the body from
 * `--shell-top-h` and `--shell-bottom-h`, which are always the bars' real
 * heights including safe areas, so nothing has to measure the header at
 * runtime. Position children absolutely or with flex inside it.
 */
export function ShellFullBleed({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div data-shell-body="full-bleed" className={className ? `shell-full-bleed ${className}` : "shell-full-bleed"} {...rest} />;
}
