"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, FormField, TextInput } from "@devdigest/ui";
import { TARGET_CARDS } from "../../constants";
import { s } from "./styles";

/** Target step (G3/AC-5) — 4 cards, only GitHub Actions is selectable; the
 *  other three render visually disabled (no generator exists for them,
 *  Non-goals) and never accept a click. The target repo input lives here
 *  too — it's needed by the very next step's Preview fetch, which already
 *  requires a non-empty `repo` (the contract's `CiExportInput.repo` is
 *  `z.string().min(1)`). */
export function TargetStep({ repo, onRepoChange }: { repo: string; onRepoChange: (v: string) => void }) {
  const t = useTranslations("ci");

  return (
    <div>
      <div style={s.cards}>
        {TARGET_CARDS.map((card) => {
          const CardIcon = Icon[card.icon];
          const selected = card.enabled; // only "gha" is ever enabled/selected
          return (
            <div key={card.key} role="button" aria-disabled={!card.enabled} style={s.card(card.enabled, selected)}>
              <CardIcon size={20} style={s.cardIcon(selected)} />
              <span style={s.cardLabel}>{t(card.labelKey)}</span>
              <span style={s.cardDesc}>{t(card.descKey)}</span>
            </div>
          );
        })}
      </div>
      <FormField label={t("exportWizard.repoLabel")} hint={t("exportWizard.repoHint")} required>
        <TextInput value={repo} onChange={onRepoChange} placeholder={t("exportWizard.repoPlaceholder")} mono />
      </FormField>
    </div>
  );
}
