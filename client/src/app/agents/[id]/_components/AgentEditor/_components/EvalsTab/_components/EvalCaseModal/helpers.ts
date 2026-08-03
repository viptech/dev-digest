/** true when text is empty (treated as "no override") or valid JSON. */
export function isValidJson(text: string): boolean {
  if (text.trim().length === 0) return true;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
