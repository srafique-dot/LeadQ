import { useRef, useState } from "react";
import styles from "../Requester.module.css";
import { importLeads, type ImportRow, type ImportResult } from "../../../api/leads";
import { parseImportFile, parsePastedLeads } from "./importParsers";

interface ImportModalProps {
  onClose: () => void;
  onImported: (result: ImportResult, cohort: string) => void;
}

const RECENT_BATCHES = ["Sep health camp — Uttara", "Meta ads — Sep", "Corporate: Brac Bank"];

export function ImportModal({ onClose, onImported }: ImportModalProps) {
  const [cohort, setCohort] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState("");
  const [pasted, setPasted] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ready = cohort.trim().length > 0;

  async function importRows(rows: ImportRow[], notFoundMessage: string) {
    if (!rows.length) {
      setParseError(notFoundMessage);
      return;
    }
    if (rows.length > 5000) {
      setParseError(`That's ${rows.length} rows. Split it into files of 5,000 or fewer and import each one.`);
      return;
    }
    setParseError("");
    let outcome: ImportResult;
    try {
      outcome = await importLeads(rows, cohort.trim(), instructions.trim());
    } catch {
      setParseError("The import didn't go through, so nothing was added. Check your connection and try again.");
      return;
    }
    setResult(outcome);
    onImported(outcome, cohort.trim());
  }

  function handleFile(file: File) {
    if (!ready) return;
    file
      .text()
      .then((text) => importRows(parseImportFile(text), "Couldn’t find any rows — check the file has a name and a phone number column."))
      .catch(() => setParseError("Couldn’t read that file."));
  }

  function handlePasteImport() {
    if (!ready || !pasted.trim()) return;
    importRows(
      parsePastedLeads(pasted),
      "Couldn’t find a lead in that text — check it has a category line (e.g. “Appointment:”), a phone number and a name.",
    );
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

        <label className={styles.field} style={{ marginTop: 14 }}>
          <span className={styles.fieldLabel}>Or paste straight from the website</span>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
            placeholder={"Copy one or more enquiries from the website's detail page and paste them here — one or many at once"}
            className={styles.textarea}
            disabled={!ready}
          />
          <span className={styles.hint}>Works whether you copy one enquiry or several at a time.</span>
        </label>
        {pasted.trim() && (
          <button
            type="button"
            className={styles.pillBtn}
            style={{ marginTop: 8, opacity: ready ? 1 : 0.6 }}
            disabled={!ready}
            onClick={handlePasteImport}
          >
            Add pasted leads
          </button>
        )}

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
                {result.duplicates.length} number{result.duplicates.length === 1 ? "" : "s"} already existed:
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {result.duplicates.slice(0, 50).map((d, i) => (
                    <li key={i}>
                      {d.row.name} ({d.row.phone})
                      {d.addedAsEntry
                        ? ` — a different request than what's on file for ${d.existing.name}, added to that lead's history`
                        : ` — already in the system as ${d.existing.name}, skipped`}
                    </li>
                  ))}
                  {result.duplicates.length > 50 && <li>…and {result.duplicates.length - 50} more.</li>}
                </ul>
              </>
            )}
            {result.skipped > 0 && (
              <div style={{ marginTop: 6 }}>
                {result.skipped} row{result.skipped === 1 ? " was" : "s were"} left out for having no name or no usable phone
                number.
              </div>
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
