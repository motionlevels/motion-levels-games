export function cleanNameWhitespace(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength).trim();
}

// A draft keeps its trailing space so physical and touch keyboards can enter
// multi-word names. Commit with cleanNameWhitespace on blur or Done.
export function cleanNameDraft(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").replace(/^\s/u, "").slice(0, maxLength);
}
