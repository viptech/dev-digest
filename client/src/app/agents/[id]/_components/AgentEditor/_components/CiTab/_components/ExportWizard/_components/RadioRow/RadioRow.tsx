import React from "react";
import { s } from "./styles";

/**
 * A single radio-style row (circle indicator + label + optional badge/hint).
 * No `Radio`/`RadioGroup` primitive exists in `@devdigest/ui` (checked via
 * `Glob` this session) — this is a small local one, colocated inside
 * `ExportWizard/_components/` because it has exactly two callers so far
 * (`ConfigureStep`'s "Post results as", `InstallStep`'s "Open a PR" vs
 * "Copy files"), both within this same feature. Promote to
 * `@devdigest/ui`/`vendor/ui` only if a THIRD, unrelated feature needs a
 * radio row (react-ui-architecture: "promote on the second user" — the
 * second user here is still inside one feature, so it stays local).
 */
export function RadioRow({
  checked,
  onSelect,
  label,
  badge,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  label: React.ReactNode;
  badge?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div role="radio" aria-checked={checked} tabIndex={0} onClick={onSelect} style={s.row(checked)}>
      <span style={s.circle(checked)}>{checked && <span style={s.dot} />}</span>
      <div style={s.textCol}>
        <div style={s.labelRow}>
          <span style={s.label}>{label}</span>
          {badge}
        </div>
        {hint && <div style={s.hint}>{hint}</div>}
      </div>
    </div>
  );
}
