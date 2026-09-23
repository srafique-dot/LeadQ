import { useState } from "react";
import styles from "../Agent.module.css";

interface EscalateModalProps {
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}

/** The situations an agent can't settle on the phone and a team lead can. */
const REASONS = [
  "Complaint about a past visit",
  "Wants a discount or price exception",
  "Doctor or schedule not in the system",
  "Medical question for a clinician",
  "Corporate or insurance query",
  "Caller angry or abusive",
];

export function EscalateModal({ onConfirm, onClose }: EscalateModalProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready = reason.trim().length >= 4;

  async function send() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm(reason.trim());
    } catch {
      setError("Couldn't send it. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.smallOverlay} ${styles.smallOverlayCenter}`}>
      <div className={`${styles.smallModal} ${styles.smallModalNarrow}`}>
        <div className={styles.escalateTitle}>Send to supervisor</div>
        <div className={styles.escalateBody}>
          Say why, so your team lead can act without calling you over. The lead leaves your queue and comes back to you
          when they return it.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0 8px" }}>
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              className={styles.smallBtn}
              style={reason === r ? { background: "var(--primary-tint)", borderColor: "var(--primary)", color: "var(--primary-dark)" } : undefined}
              onClick={() => setReason(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          autoFocus
          placeholder="Or write it in your own words…"
          className={styles.notesTextarea}
          style={{ width: "100%", boxSizing: "border-box" }}
        />
        {error && <div style={{ color: "var(--danger)", fontSize: 13, marginTop: 6 }}>{error}</div>}
        <div className={styles.escalateActions}>
          <button
            type="button"
            className={styles.sendBtn}
            disabled={!ready || busy}
            style={!ready || busy ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            onClick={send}
          >
            {busy ? "Sending…" : "Send it"}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
