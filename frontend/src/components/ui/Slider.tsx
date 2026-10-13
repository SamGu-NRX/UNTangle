"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cx } from "./cx";
import {
  moveRangeThumb,
  nearestThumb,
  ratioFromValue,
  valueForKey,
  valueFromRatio,
  type SliderBounds,
} from "./slider-math";

type Shared = {
  /** Visible label above the track; also the accessible name. */
  label: string;
  min: number;
  max: number;
  step?: number;
  /** Text for a value: the bubble, the right-hand readout and aria-valuetext. */
  formatValue?: (value: number) => string;
  /** Labels under the two ends of the track. */
  minLabel?: ReactNode;
  maxLabel?: ReactNode;
  /** 1px ticks at each step. Use only when there are few steps. */
  ticks?: boolean;
  disabled?: boolean;
  className?: string;
};

export type SliderProps = Shared & { value: number; onValueChange: (value: number) => void };
export type RangeSliderProps = Shared & {
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
  /** Smallest allowed distance between the thumbs. Defaults to one step. */
  minGap?: number;
  /** Accessible names for the two thumbs. */
  thumbLabels?: [string, string];
};

/** One thumb: 18px, a value bubble while dragged or keyboard-focused. */
export function Slider(props: SliderProps) {
  const { value, onValueChange, ...shared } = props;
  return <SliderBase {...shared} values={[value]} onValues={(next) => onValueChange(next[0])} />;
}

/** Two thumbs that fill between and cannot cross. */
export function RangeSlider(props: RangeSliderProps) {
  const { value, onValueChange, minGap, thumbLabels, ...shared } = props;
  return (
    <SliderBase
      {...shared}
      values={value}
      minGap={minGap}
      thumbLabels={thumbLabels ?? [`${shared.label}, from`, `${shared.label}, to`]}
      onValues={(next) => onValueChange([next[0], next[1]])}
    />
  );
}

function SliderBase({
  label,
  min,
  max,
  step = 1,
  formatValue = String,
  minLabel,
  maxLabel,
  ticks,
  disabled,
  className,
  values,
  onValues,
  minGap,
  thumbLabels,
}: Shared & {
  values: number[];
  onValues: (values: number[]) => void;
  minGap?: number;
  thumbLabels?: [string, string];
}) {
  const bounds: SliderBounds = { min, max, step };
  const isRange = values.length === 2;
  const gap = minGap ?? step;
  const labelId = useId();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [dragging, setDragging] = useState<number | null>(null);

  const setThumb = (thumb: number, next: number) => {
    if (isRange) {
      onValues(moveRangeThumb([values[0], values[1]], thumb as 0 | 1, next, gap));
    } else {
      onValues([next]);
    }
  };

  const valueAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return valueFromRatio((clientX - rect.left) / rect.width, bounds);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0 || dragging !== null) return;
    event.preventDefault();
    const next = valueAt(event.clientX);
    const thumb = isRange ? nearestThumb([values[0], values[1]], next) : 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(thumb);
    setThumb(thumb, next);
    thumbRefs.current[thumb]?.focus({ preventScroll: true });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging === null) return;
    setThumb(dragging, valueAt(event.clientX));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>, thumb: number) => {
    if (disabled) return;
    const next = valueForKey(values[thumb], event.key, event.shiftKey, bounds);
    if (next === null) return;
    event.preventDefault();
    setThumb(thumb, next);
  };

  const ratios = values.map((v) => ratioFromValue(v, bounds) * 100);
  const fillStart = isRange ? ratios[0] : 0;
  const fillEnd = isRange ? ratios[1] : ratios[0];
  const readout = isRange ? `${formatValue(values[0])} – ${formatValue(values[1])}` : formatValue(values[0]);
  const stepCount = Math.round((max - min) / step);

  return (
    <div className={cx("ui-slider", disabled && "ui-slider--disabled", className)} data-ui="">
      <div className="ui-slider__head">
        <span id={labelId}>{label}</span>
        <b aria-hidden="true">{readout}</b>
      </div>
      <div
        ref={trackRef}
        className="ui-slider__track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="ui-slider__rail" />
        {ticks && stepCount <= 40
          ? Array.from({ length: stepCount + 1 }, (_, i) => (
              <span key={i} className="ui-slider__tick" style={{ left: `${(i / stepCount) * 100}%` }} aria-hidden="true" />
            ))
          : null}
        <div className="ui-slider__fill" style={{ left: `${fillStart}%`, right: `${100 - fillEnd}%` }} />
        {values.map((v, thumb) => (
          <span
            key={thumb}
            ref={(node) => {
              thumbRefs.current[thumb] = node;
            }}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-labelledby={isRange ? undefined : labelId}
            aria-label={isRange ? thumbLabels?.[thumb] : undefined}
            aria-valuemin={isRange && thumb === 1 ? values[0] + gap : min}
            aria-valuemax={isRange && thumb === 0 ? values[1] - gap : max}
            aria-valuenow={v}
            aria-valuetext={formatValue(v)}
            aria-disabled={disabled || undefined}
            aria-orientation="horizontal"
            className="ui-slider__thumb"
            data-active={dragging === thumb ? "" : undefined}
            data-ui=""
            style={{ left: `${ratios[thumb]}%` }}
            onKeyDown={(event) => onKeyDown(event, thumb)}
          >
            <span className="ui-slider__bubble" aria-hidden="true" data-ui="">
              {formatValue(v)}
            </span>
          </span>
        ))}
      </div>
      {minLabel !== undefined || maxLabel !== undefined ? (
        <div className="ui-slider__ends" aria-hidden="true">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
