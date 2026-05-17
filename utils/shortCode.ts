// Customer-facing short code generator used across the admin dashboard.
// Each section gets its own prefix (FLIPRT for reps, FLIPSER for
// services, FLIPIND for B2B enquiries, FLIPDOC for vault enquiries,
// FLIPUP for vault uploads, FLIPID for customers) followed by N digits.
// Derived deterministically from the row's UUID via FNV-1a so the same
// row always shows the same short code — no DB column, no migration.
//
// CRITICAL: the FLIPRT 5-digit variant is also implemented in the
// customer app at customerandroidapp/src/utils/agent/repCode.ts.
// If you change the formula here, keep the rep-side helper in sync
// so admin and the rep app continue to show identical codes.

const hashDigits = (input: string, digits: number): string => {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits) - 1;
  const range = max - min + 1;
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = (Math.abs(h | 0) % range) + min;
  return String(n);
};

/**
 * Build a short display code for any UUID-keyed row.
 *
 *   shortCode('FLIPSER', '3cb1a201-...', 3) → 'FLIPSER-487'
 *   shortCode('FLIPRT',  '1f8fe081-...', 5) → 'FLIPRT-11542'
 */
export const shortCode = (
  prefix: string,
  id: unknown,
  digits = 3,
): string => {
  const seed = String(id || '');
  if (!seed) return `${prefix}-${'0'.repeat(digits)}`;
  return `${prefix}-${hashDigits(seed, digits)}`;
};
