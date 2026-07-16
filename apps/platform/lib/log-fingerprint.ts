/**
 * Stable fingerprint of a sensitive value (e.g. email) for log/observability
 * correlation. NOT a cryptographic hash — just a deterministic, short
 * identifier that lets engineers search logs without storing the raw PII.
 *
 * FNV-1a 32-bit. Same input → same fingerprint across processes.
 */
export function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fp_${(hash >>> 0).toString(16)}`;
}
