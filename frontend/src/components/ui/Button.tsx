"use client";

import type { ComponentPropsWithRef, MouseEvent, ReactNode } from "react";
import { cx } from "./cx";
import { ChevronDown, Spinner } from "./icons";
import { Menu, type MenuEntry } from "./Menu";

/**
 * `secondary` is the v1 name for `ghost` and renders identically; v1's
 * borderless `ghost` look is now `quiet`.
 */
export type ButtonVariant = "primary" | "ghost" | "quiet" | "destructive" | "link" | "secondary";
export type ButtonSize = "md" | "sm";

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Shows a spinner and `loadingLabel` in the label's place; the width holds.
   * Pass it (even as `false`) only on buttons that can load: the hidden
   * loading label is rendered only then, so a plain button's text appears
   * once in the DOM (textContent, find-in-page, copy).
   */
  loading?: boolean;
  /** The verb shown while loading, e.g. "Filling…". Defaults to the label. */
  loadingLabel?: ReactNode;
  /** Leading 16px glyph. */
  icon?: ReactNode;
};

const variantClass: Record<ButtonVariant, string> = {
  primary: "ui-btn--primary",
  ghost: "ui-btn--ghost",
  secondary: "ui-btn--ghost",
  quiet: "ui-btn--quiet",
  destructive: "ui-btn--destructive",
  link: "ui-btn--link",
};

export function Button({
  variant = "primary",
  size = "md",
  loading: loadingProp,
  loadingLabel,
  icon,
  className,
  children,
  onClick,
  type = "button",
  ...rest
}: ButtonProps) {
  const loading = loadingProp === true;
  const canLoad = loadingProp !== undefined || loadingLabel !== undefined;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // aria-disabled rather than `disabled` while loading, so a focused
    // button keeps focus through the run instead of dropping it to <body>.
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      type={type}
      className={cx("ui-btn", variantClass[variant], size === "sm" && "ui-btn--sm", className)}
      data-ui=""
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      data-loading={loading ? "" : undefined}
      onClick={handleClick}
      {...rest}
    >
      <span className="ui-btn__stack">
        <span className="ui-btn__label" aria-hidden={loading || undefined}>
          {icon ? <span className="ui-btn__icon">{icon}</span> : null}
          {children}
        </span>
        {canLoad ? (
          <span className="ui-btn__label ui-btn__label--loading" aria-hidden={!loading || undefined}>
            <Spinner />
            {loadingLabel ?? children}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export type IconButtonProps = Omit<ButtonProps, "icon" | "children" | "loadingLabel"> & {
  /** Accessible name; icon buttons have no visible text. */
  label: string;
  children: ReactNode;
};

/** 36px (32px small) square button for a single glyph. Defaults to quiet. */
export function IconButton({ label, variant = "quiet", className, children, ...rest }: IconButtonProps) {
  return (
    <Button variant={variant} className={cx("ui-btn--icon", className)} aria-label={label} {...rest}>
      {children}
    </Button>
  );
}

export type SplitButtonProps = {
  children: ReactNode;
  onClick: () => void;
  /** Accessible name of the caret's menu, e.g. "More ways to auto-fill". */
  menuLabel: string;
  menuItems: MenuEntry[];
  icon?: ReactNode;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: ReactNode;
  disabled?: boolean;
};

/**
 * Primary action with a 28px caret segment that opens a Menu. Two real
 * buttons, drawn as one: the group presses as a unit.
 */
export function SplitButton({
  children,
  onClick,
  menuLabel,
  menuItems,
  icon,
  size = "md",
  loading,
  loadingLabel,
  disabled,
}: SplitButtonProps) {
  return (
    <div className={cx("ui-split", size === "sm" && "ui-split--sm")} role="group" data-ui="">
      <Button
        size={size}
        icon={icon}
        loading={loading}
        loadingLabel={loadingLabel}
        disabled={disabled}
        onClick={onClick}
        className="ui-split__main"
      >
        {children}
      </Button>
      <Menu
        label={menuLabel}
        align="end"
        items={menuItems}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className="ui-split__caret"
            aria-label={menuLabel}
            disabled={disabled || loading}
          >
            <ChevronDown size={14} />
          </button>
        )}
      />
    </div>
  );
}
