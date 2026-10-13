"use client";

import { useId, type ReactNode } from "react";
import { cx } from "./cx";

export type SwitchProps = {
  checked: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** Name when there is no visible `label`. */
  ariaLabel?: string;
  /** Text beside the switch; makes the whole row the hit area. */
  label?: ReactNode;
  /** A meta line under the label. */
  description?: ReactNode;
  className?: string;
  id?: string;
};

/**
 * A switch for true on/off settings only, never for a status with three
 * values. 40×24 track with a 20px knob that travels 16px (DESIGN.md §8.2).
 */
export function Switch({ checked, onChange, disabled, ariaLabel, label, description, className, id }: SwitchProps) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const descriptionId = `${baseId}-description`;
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={label && description ? descriptionId : undefined}
      disabled={disabled}
      className={cx("ui-switch", label ? "ui-switch--row" : undefined, className)}
      data-ui=""
      onClick={() => onChange?.(!checked)}
    >
      <span className="ui-switch__track" aria-hidden="true" data-ui="">
        <span className="ui-switch__knob" data-ui="" />
      </span>
      {label ? (
        <span className="ui-switch__text">
          <span id={labelId} className="ui-switch__label">
            {label}
          </span>
          {description ? (
            <span id={descriptionId} className="ui-switch__description">
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
