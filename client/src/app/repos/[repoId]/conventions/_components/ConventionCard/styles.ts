export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: 16,
    background: "var(--bg-elevated)",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } as React.CSSProperties,
  rule: { fontSize: 14, fontWeight: 600 } as React.CSSProperties,
  evidence: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    borderRadius: 6,
    padding: 8,
    whiteSpace: "pre-wrap",
  } as React.CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } as React.CSSProperties,
};
