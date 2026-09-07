import type { LeadStatus } from "../../api/types";

export const STATUS_STYLE: Record<LeadStatus, { label: string; dot: string; bg: string; border: string; fg: string }> = {
  waiting: { label: "Waiting for a call", dot: "#9A6206", bg: "#FDF9EE", border: "#EBDCB4", fg: "#7A4E06" },
  trying: { label: "Being called", dot: "#0E7C86", bg: "#E7F1F2", border: "#C5DEE0", fg: "#0A5C64" },
  booked: { label: "Booked", dot: "#1B7A4B", bg: "#E9F6F1", border: "#B7E0D0", fg: "#125C3D" },
  closed: { label: "Closed", dot: "#9C3B31", bg: "#FDF5F4", border: "#F0CFCA", fg: "#9C3B31" },
};
