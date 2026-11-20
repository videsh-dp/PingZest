/**
 * MongoDB document ids are 24-character hex strings (ObjectId).
 * Returns the id, or null for anything else, so a bad form value never reaches the database.
 */
export function toId(value) {
  const s = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{24}$/.test(s) ? s : null;
}
