import type { ReactNode } from "react";

/**
 * The 44px row at the top of a view (DESIGN.md §2): the view's context on
 * the left (title 15/600 and a meta line), its primary action on the right.
 * It replaces the large per-view headlines; the title is the page's h1.
 */
export function ViewHeader({ title, meta, actions }: { title: string; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="view-header">
      <div className="view-header__context">
        <h1 className="view-header__title">{title}</h1>
        {meta ? <span className="view-header__meta">{meta}</span> : null}
      </div>
      {actions ? <div className="view-header__actions">{actions}</div> : null}
    </header>
  );
}
