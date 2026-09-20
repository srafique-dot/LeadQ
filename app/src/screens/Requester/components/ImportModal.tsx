import { useRef, useState } from "react";
import styles from "../Requester.module.css";
import { importLeads, type ImportRow, type ImportResult } from "../../../api/leads";
import type { Account } from "../../../api/types";

interface ImportModalProps {
  currentUser: Account;
  onClose: () => void;
  onImported: (result: ImportResult, cohort: string) => void;
}

const RECENT_BATCHES = ["Sep health camp — Uttara", "Meta ads — Sep", "Corporate: Brac Bank"];

function parseCsv(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const splitLine = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

  const first = splitLine(lines[0]);
  const looksLikeHeader = first[0]?.toLowerCase() === "name";
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;

  return dataLines
    .map(splitLine)
    .filter((cols) => cols.length >= 2 && cols[0] && cols[1])
    .map((cols) => ({
      name: cols[0] ?? "",
      phone: cols[1] ?? "",
      facility: cols[2] ?? "",
      doctorOrDept: cols[3] ?? "",
    }));
}

export function ImportModal({ currentUser, onClose, onImported }: ImportModalProps) {
  const [cohort, setCohort] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ready = cohort.trim().length > 0;

  function handleFile(file: File) {
    if (!ready) return;
    file
      .text()
      .then(async (text) => {
        const rows = parseCsv(text);
        if (!rows.length) {
          setParseError("Couldn’t find any rows — check the file has name, phone, hospital, doctor or department.");
          return;
        }
        setParseError("");
        const outcome = await importLeads(rows, cohort.trim(), currentUser.employeeId, currentUser.name, instructions.trim());
        setResult(outcome);
        onImported(outcome, cohort.trim());
      })
      .catch(() => setParseError("Couldn’t read that file."));
  }

  return (
    <div className={`${styles.overlay} ${styles.center}`}>
      <div className={`${styles.modalCard} ${styles.narrowFixed}`}>
        <div className={styles.modalTitle} style={{ fontSize: 18 }}>
          Import a file
        </div>
        <div className={styles.modalSubtitle} style={{ marginTop: 8, lineHeight: 1.6 }}>
          One row per lead: name, phone, hospital, doctor or department. Every row is checked against existing
          numbers before anything is created — you review the duplicates before they go in.
        </div>

        <label className={styles.field} style={{ marginTop: 18 }}>
          <span className={styles.fieldLabel}>
            Name this batch <span className={styles.required}>— required</span>
          </span>
          <input
            value={cohort}
            onChange={(e) => setCohort(e.target.value)}
            placeholder="e.g. Sep health camp — Uttara"
            className={styles.textInput}
            style={{ borderWidth: 1.5, borderStyle: "solid", borderColor: ready ? "var(--success-tint-border)" : "var(--border-input)" }}
          />
          <span className={styles.hint}>Every row gets this tag, so you can see later how this batch performed against the rest.</span>
        </label>

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
          {RECENT_BATCHES.map((c) => (
            <button key={c} type="button" className={styles.pillBtn} onClick={() => setCohort(c)}>
              {c}
            </button>
          ))}
        </div>

        <label className={styles.field} style={{ marginTop: 14 }}>
          <span className={styles.fieldLabel}>
            Instructions for call agents <span className={styles.muted}>— optional</span>
          </span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            placeholder="e.g. Dr. Shelly's patients — offer the executive check-up, mention her by name"
            className={styles.textarea}
          />
          <span className={styles.hint}>Agents can pull this up from the lead card to refresh their memory on this batch.</span>
        </label>

        <div
          className={`${styles.dropZone} ${ready ? styles.active : ""}`}
          style={{
            borderColor: ready ? "#C9D6DA" : "var(--border)",
            background: ready ? "var(--surface)" : "var(--surface-subtle)",
          }}
          onClick={() => ready && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (ready) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
        >
          <div className={styles.dropTitle} style={{ color: ready ? "var(--ink)" : "var(--ink-disabled)" }}>
            {ready ? (dragOver ? "Drop it" : "Drop the file here") : "Name the batch first"}
          </div>
          <div className={styles.dropSub}>
            {ready ? `CSV or Excel · every row tagged “${cohort.trim()}”` : "The tag is what makes the batch reportable later"}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {parseError && (
          <div className={styles.duplicateReview} style={{ background: "var(--danger-tint)", borderColor: "var(--danger-tint-border)", color: "var(--danger)" }}>
            {parseError}
          </div>
        )}

        {result && (
          <div className={styles.duplicateReview}>
            {result.created.length} new lead{result.created.length === 1 ? "" : "s"} added, tagged “{cohort.trim()}”.
            {result.duplicates.length > 0 && (
              <>
                {" "}
                {result.duplicates.length} number{result.duplicates.length === 1 ? "" : "s"} already existed and{" "}
                {result.duplicates.length === 1 ? "was" : "were"} skipped:
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {result.duplicates.map((d, i) => (
                    <li key={i}>
                      {d.row.name} ({d.row.phone}) — already in the system as {d.existing.name}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 9, marginTop: 18, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 auto", fontSize: 13, color: "var(--ink-faint)", alignSelf: "center", lineHeight: 1.5 }}>
            {ready && !result ? "Imported rows go to the call centre in arrival order — not ahead of urgent leads." : ""}
          </div>
          <button type="button" className={styles.btnImport} onClick={onClose} style={{ minHeight: 46, padding: "12px 16px", borderRadius: 7, flex: "0 0 auto" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
