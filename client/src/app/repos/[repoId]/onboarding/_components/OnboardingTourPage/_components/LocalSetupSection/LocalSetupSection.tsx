"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";

/**
 * `local_setup` kind — ordered, copy-to-clipboard command list from
 * `commands[]` (package-manager install/dev/build/etc, in the server's
 * lifecycle-first order — see `orderScriptsForLocalSetup` server-side).
 */
export function LocalSetupSection({ section }: { section: OnboardingSection }) {
  const t = useTranslations("onboarding");
  const [copiedIdx, setCopiedIdx] = React.useState<number | null>(null);
  const commands = section.commands ?? [];

  const copy = (cmd: string, i: number) => {
    void navigator.clipboard?.writeText(cmd);
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx((cur) => (cur === i ? null : cur)), 1200);
  };

  return (
    <ol style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 20 }}>
      {commands.map((c, i) => (
        <li key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <code className="mono" style={{ flex: 1, fontSize: 13 }}>
            {c.cmd}
          </code>
          {c.comment && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.comment}</span>
          )}
          <button
            type="button"
            title={t("copyCommand")}
            aria-label={t("copyCommand")}
            onClick={() => copy(c.cmd, i)}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 5,
              padding: 4,
              cursor: "pointer",
              color: "var(--text-muted)",
              display: "inline-flex",
            }}
          >
            {copiedIdx === i ? <Icon.Check size={13} /> : <Icon.Copy size={13} />}
          </button>
        </li>
      ))}
    </ol>
  );
}
