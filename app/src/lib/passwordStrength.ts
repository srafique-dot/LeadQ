export function strengthOf(v: string): number {
  let n = 0;
  if (v.length >= 8) n++;
  if (v.length >= 12) n++;
  if (/[A-Z]/.test(v) && /[a-z]/.test(v)) n++;
  if (/\d/.test(v) || /[^A-Za-z0-9]/.test(v)) n++;
  return Math.min(4, n);
}

export const STRENGTH_NAMES = ["Too short", "Weak", "Fine", "Good", "Strong"];
export const STRENGTH_COLORS = ["#9C3B31", "#9C3B31", "#9A6206", "#0E7C86", "#1B7A4B"];
