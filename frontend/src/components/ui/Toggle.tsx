"use client";

import { useId, type ReactNode } from "react";
import { cx } from "./cx";

export type ToggleProps = {
  /** v1 name for `checked`. */
  on?: boolean;
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** Name when there is no visible `label`. */
  ariaLabel?: string;
  /** 14px label beside the switch; makes the whole row the hit area. */
  label?: ReactNode;
  /** 12.5px line under the label. */
  description?: ReactNode;
  className?: string;
  id?: string;
};

/**
 * A switch for true on/off settings only, never for a status with three
 * values. 36×20 track, 16px knob that slides 16px (DESIGN.md §4).
 */
export function Toggle({ on, checked, onChange, disabled, ariaLabel, label, description, className, id }: ToggleProps) {
  const isOn = Boolean(checked ?? on);
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const descriptionId = `${baseId}-description`;
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={label && description ? descriptionId : undefined}
      disabled={disabled}
      data-on={isOn ? "true" : "false"}
      className={cx("ui-toggle", label ? "ui-toggle--row" : undefined, className)}
      data-ui=""
      onClick={() => onChange?.(!isOn)}
    >
      <span className="ui-toggle__track" aria-hidden="true" data-ui="">
        <span className="ui-toggle__knob" data-ui="" />
      </span>
      {label ? (
        <span className="ui-toggle__text">
          <span id={labelId} className="ui-toggle__label">
            {label}
          </span>
          {description ? (
            <span id={descriptionId} className="ui-toggle__description">
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
