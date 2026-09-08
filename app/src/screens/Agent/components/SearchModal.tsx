import styles from "../Agent.module.css";
import { searchLeads } from "../../../api/leads";

interface SearchModalProps {
  term: string;
  onTermChange: (v: string) => void;
  onJump: (leadId: string) => void;
  onClose: () => void;
}

export function SearchModal({ term, onTermChange, onJump, onClose }: SearchModalProps) {
  const results = searchLeads(term);
  return (
    <div className={styles.smallOverlay}>
      <div className={styles.smallModal}>
        <div className={styles.smallModalHead}>
          <div className={styles.smallModalTitle}>Find a lead</div>
          <input
            autoFocus
            value={term}
            onChange={(e) => onTermChange(e.target.value)}
            placeholder="Phone number or name…"
            className={styles.searchInput}
          />
        </div>
        <div className={styles.searchResults}>
          {results.map((r) => (
            <div key={r.id} className={styles.searchRow}>
              <div style={{ minWidth: 0 }}>
                <div className={styles.searchName}>{r.name}</div>
                <div className={styles.searchPhone}>{r.phone}</div>
              </div>
              <button type="button" className={styles.workNowBtn} onClick={() => onJump(r.id)}>
                Work now
              </button>
            </div>
          ))}
        </div>
        <div className={styles.smallModalFoot}>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
