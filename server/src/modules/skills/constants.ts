/** Constants for the skills module. */

/** Default skill type when none is supplied on insert. */
export const DEFAULT_SKILL_TYPE = 'custom' as const;

/** Skills created via the "Create" flow (typed by hand in the editor). */
export const MANUAL_SOURCE = 'manual' as const;

/**
 * Skills created via the "Import from file" flow. Reuses the `imported_url`
 * enum value (no separate "imported_file" variant in the SkillSource enum) —
 * semantically both mean "not authored by hand in this workspace, vet before
 * trusting". Imported skills start DISABLED (see SkillsService.importSave)
 * until a human reviews the body and flips the toggle — this is the "chatty
 * skill = someone else's instructions in your agent's prompt" trust boundary
 * from the product spec.
 */
export const IMPORTED_SOURCE = 'imported_url' as const;
