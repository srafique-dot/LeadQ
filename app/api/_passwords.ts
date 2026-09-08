/** Unambiguous alphabet (no I/l/1/O/0), starts with a capital and a digit,
 * hyphen inserted for readability. Shown once by the caller, never stored
 * anywhere but as a hash. */
export function generatePassword(len = 8): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digit = "23456789";
  const pool = upper + lower + digit;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let out = pick(upper) + pick(digit);
  while (out.length < Math.max(6, len)) out += pick(pool);
  out = out.slice(0, len);
  return out.slice(0, 4) + "-" + out.slice(4);
}
