/** Same cohort name always renders the same color, everywhere — that's the
 * whole point, agents learn "this color = this campaign" without reading. No
 * setup needed when a new cohort is uploaded; the name alone determines it.
 * Deliberately distinct from the app's status colors (red/amber/green/teal)
 * so a cohort tag is never mistaken for a status. */

interface CohortStyle {
  bg: string;
  border: string;
  fg: string;
}

// 16 distinct hues — the floor runs up to 10-15 cohorts at once, so the
// palette needs headroom above that before two unrelated cohorts collide.
const PALETTE: CohortStyle[] = [
  { bg: "#E8F0FE", border: "#C7DBFA", fg: "#1A56B0" }, // blue
  { bg: "#F1EAFB", border: "#DCC9F5", fg: "#6B3FA0" }, // purple
  { bg: "#FCEAF1", border: "#F5C9DC", fg: "#A02A5C" }, // rose
  { bg: "#FEF0E4", border: "#F7D6B3", fg: "#A85A12" }, // orange
  { bg: "#E3F4F1", border: "#B9E3D9", fg: "#0F6B5C" }, // teal (dark, distinct from primary)
  { bg: "#EBEBFB", border: "#CFCFF5", fg: "#4640B5" }, // indigo
  { bg: "#F5EEE4", border: "#E3D2B8", fg: "#7A5230" }, // tan
  { bg: "#E3F5FB", border: "#B9E3F0", fg: "#146A8C" }, // cyan
  { bg: "#EEF3E0", border: "#D3E3B4", fg: "#556B1E" }, // olive
  { bg: "#FBEAEE", border: "#F3C6D0", fg: "#A02040" }, // crimson
  { bg: "#F7EAFB", border: "#EACBF5", fg: "#8A2FA0" }, // magenta
  { bg: "#E4F1FE", border: "#B9DBF7", fg: "#0C6FA8" }, // sky
  { bg: "#F2ECE0", border: "#DECBAA", fg: "#8A5A1E" }, // amber-brown
  { bg: "#EAF6E9", border: "#C3E6C0", fg: "#2A7A3C" }, // leaf green
  { bg: "#EDEEF5", border: "#CBCEE3", fg: "#4A5080" }, // slate blue
  { bg: "#FBEDE4", border: "#F0CDB6", fg: "#A34E27" }, // terracotta
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function cohortColor(cohort: string): CohortStyle {
  return PALETTE[hashString(cohort) % PALETTE.length];
}
