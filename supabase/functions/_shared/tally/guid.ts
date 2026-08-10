/**
 * Deterministic UUID-shaped id derived from a stable key.
 *
 * Deterministic on purpose: re-enqueuing the same bill produces the same GUID,
 * so the queue's unique index and the delivered-GUID checks recognise the
 * duplicate instead of booking the voucher twice. Not cryptographic — it only
 * has to avoid collisions across one company's ledger and stock item names.
 *
 * Lives in its own module because both jobs.ts (which mints GUIDs) and
 * matching.ts (which maps a stored matched_to_guid back to a master name)
 * need it, and jobs.ts imports matching.ts.
 */
export function deterministicGuid(namespace: string, key: string): string {
  const input = `${namespace}:${key}`;
  const words = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    for (let w = 0; w < words.length; w++) {
      words[w] ^= code + i * (w + 1);
      words[w] = Math.imul(words[w], 0x01000193) >>> 0;
      words[w] = ((words[w] << 13) | (words[w] >>> 19)) >>> 0;
    }
  }

  const hex = words.map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}
