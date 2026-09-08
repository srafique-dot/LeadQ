import styles from "../Agent.module.css";

interface EscalateModalProps {
  onConfirm: () => void;
  onClose: () => void;
}

export function EscalateModal({ onConfirm, onClose }: EscalateModalProps) {
  return (
    <div className={`${styles.smallOverlay} ${styles.smallOverlayCenter}`}>
      <div className={`${styles.smallModal} ${styles.smallModalNarrow}`}>
        <div className={styles.escalateTitle}>Send to supervisor?</div>
        <div className={styles.escalateBody}>
          The lead leaves your queue with your notes attached and you move to the next one.
        </div>
        <div className={styles.escalateActions}>
          <button type="button" className={styles.sendBtn} onClick={onConfirm}>
            Send it
          </button>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
