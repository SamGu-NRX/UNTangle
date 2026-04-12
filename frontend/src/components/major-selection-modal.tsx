"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { StaggerGroup } from "@/components/ui/StaggerGroup";
import { majors } from "@/lib/seed-data";
import type { MajorId } from "@/lib/types";

export function MajorSelectionModal({
  open,
  current,
  onClose,
  onConfirm,
  origin,
  closable = true,
}: {
  open: boolean;
  current: MajorId | null;
  onClose: () => void;
  onConfirm: (id: MajorId) => void;
  origin?: { x: number; y: number } | null;
  closable?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      origin={origin ?? null}
      closable={closable}
      maxWidth={620}
      title={
        <div>
          <p className="editorial-label">Choose your major</p>
          <h2
            className="font-display"
            style={{
              marginTop: 4,
              fontSize: "1.4rem",
              fontWeight: 800,
              color: "var(--brand-900)",
              letterSpacing: "-0.03em",
            }}
          >
            What are you studying?
          </h2>
          <p style={{ fontSize: "0.82rem", color: "var(--copy)", marginTop: 4 }}>
            We&apos;ll highlight your core courses and unlock prerequisites as you complete them.
          </p>
        </div>
      }
    >
      <MajorSelectionContent
        current={current}
        onClose={onClose}
        onConfirm={onConfirm}
        closable={closable}
      />
    </Modal>
  );
}

function MajorSelectionContent({
  current,
  onClose,
  onConfirm,
  closable,
}: {
  current: MajorId | null;
  onClose: () => void;
  onConfirm: (id: MajorId) => void;
  closable: boolean;
}) {
  const [pending, setPending] = useState<MajorId | null>(current);

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        <StaggerGroup step={25}>
          {majors.map((m) => {
            const active = pending === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setPending(m.id)}
                style={{
                  textAlign: "left",
                  padding: "0.85rem 0.85rem",
                  border: `1px solid ${active ? "var(--brand-500)" : "var(--line)"}`,
                  background: active ? "var(--success-bg)" : "var(--surface)",
                  borderRadius: "var(--r-md)",
                  cursor: "pointer",
                  transition:
                    "border-color 150ms var(--ease), background-color 150ms var(--ease), color 150ms var(--ease)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-display-syne)",
                    fontSize: "1rem",
                    fontWeight: 800,
                    color: active ? "var(--brand-700)" : "var(--brand-900)",
                  }}
                >
                  {m.icon}
                </div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: "0.88rem",
                    fontWeight: 700,
                    color: "var(--ink)",
                    lineHeight: 1.2,
                  }}
                >
                  {m.name}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--copy)", marginTop: 2 }}>
                  {m.department}
                </div>
              </button>
            );
          })}
        </StaggerGroup>
      </div>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        {closable ? (
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        ) : null}
        <Button
          disabled={!pending}
          onClick={() => {
            if (pending) onConfirm(pending);
          }}
        >
          Confirm
        </Button>
      </div>
    </>
  );
}
