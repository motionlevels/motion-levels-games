const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const lowercaseHashPattern = /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/;

// Platform-authored entities use an opaque durable id. UUIDs remain accepted
// for today's rows, while content-addressed ids are deliberately lowercase so
// the same identifier cannot acquire multiple spellings in persisted state.
export function isCanonicalEntityID(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return uuidPattern.test(normalized) || lowercaseHashPattern.test(normalized);
}
