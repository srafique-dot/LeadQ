import { useEffect, useState } from "react";
import styles from "../SignIn/SignIn.module.css";
import { useAuth } from "../../context/AuthContext";
import { getInviteContext, claimInvite, type InviteContext, type ClaimInviteError } from "../../api/auth";
import { strengthOf, STRENGTH_NAMES, STRENGTH_COLORS } from "../../lib/passwordStrength";

const ERROR_TEXT: Record<ClaimInviteError, string> = {
  missing_name: "Write your first and last name.",
  too_short: "At least 8 characters.",
  invalid_id: "First name should be a single word (letters only), and the employee ID a few digits.",
  invalid_token: "This invite link isn't valid.",
  already_used: "This invite has already been used to create an account.",
  id_taken: "That employee ID already has an account — check the digits your team lead gave you.",
  network: "Couldn't reach the server. Check your connection and try again.",
};

interface ClaimInviteProps {
  token: string;
}

export function ClaimInvite({ token }: ClaimInviteProps) {
  const { refresh } = useAuth();
  const [loading, setLoading] = useState(true);
  const [context, setContext] = useState<InviteContext | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [eid, setEid] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [repeatPw, setRepeatPw] = useState("");
  const [show, setShow] = useState(false);
  const [stay, setStay] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getInviteContext(token).then((c) => {
      setContext(c);
      setLoading(false);
    });
  }, [token]);

  const previewId = firstName.trim() && eid.trim() ? `${firstName.trim().toUpperCase()}_${eid.trim()}` : "";
  const strength = strengthOf(pw);

  const blocker = !firstName.trim()
    ? "Write your first name."
    : !/^[A-Za-z]+$/.test(firstName.trim())
      ? "First name should be a single word, letters only."
      : !lastName.trim()
        ? "Write your last name."
        : !/^\d{2,6}$/.test(eid.trim())
          ? "Employee ID should be 2–6 digits."
          : !email.trim()
            ? "Write your email address."
            : pw.length < 8
              ? "At least 8 characters."
              : !repeatPw
                ? "Type your password a second time."
                : repeatPw !== pw
                  ? "The two do not match."
                  : "";

  async function submit() {
    if (blocker) return;
    setBusy(true);
    const result = await claimInvite(token, { firstName, lastName, eid, email, password: pw }, stay);
    setBusy(false);
    if (!result.ok) {
      setError(ERROR_TEXT[result.error]);
      return;
    }
    refresh();
  }

  if (loading) return <div className={styles.page} />;

  if (!context) {
    return (
      <div className={styles.page}>
        <div className={styles.wrap}>
          <div className={styles.brand}>
            <img src="/assets/umch-logo.png" alt="United Healthcare" />
            <span>Outbound queue</span>
          </div>
          <div className={styles.card}>
            <h1 className={styles.heading}>This link isn't valid</h1>
            <div className={styles.subNote}>
              It's either already been used or doesn't exist. Ask your team lead for a fresh invite link.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.brand}>
          <img src="/assets/umch-logo.png" alt="United Healthcare" />
          <span>Outbound queue</span>
        </div>
        <div className={styles.card}>
          <div className={styles.pill}>
            <span className={styles.pillDot} />
            <span className={styles.pillText}>You're invited</span>
          </div>
          <h1 className={styles.heading} style={{ marginTop: 14 }}>
            Set up your account
          </h1>
          <div className={styles.subNote}>
            Joining as {context.roleLabel}
            {context.facility ? ` at ${context.facility}` : ""}. Pick your own password — nobody else will see it.
          </div>

          <div className={styles.fields}>
            <div style={{ display: "flex", gap: 10 }}>
              <label className={styles.field} style={{ flex: 1 }}>
                <span className={styles.fieldLabel}>First name</span>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Sameer"
                  className={styles.idInput}
                  style={{ textTransform: "none" }}
                />
              </label>
              <label className={styles.field} style={{ flex: 1 }}>
                <span className={styles.fieldLabel}>Last name</span>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Rahman"
                  className={styles.idInput}
                  style={{ textTransform: "none" }}
                />
              </label>
            </div>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Employee ID</span>
              <input
                value={eid}
                onChange={(e) => setEid(e.target.value)}
                placeholder="3451"
                inputMode="numeric"
                className={styles.idInput}
                style={{ textTransform: "none" }}
              />
              {previewId && <span className={styles.hint}>You'll sign in as {previewId}</span>}
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={styles.idInput}
                style={{ textTransform: "none" }}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Password</span>
              <input
                type={show ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                className={styles.idInput}
                style={{ fontSize: 18, textTransform: "none" }}
              />
              <div className={styles.strengthRow}>
                <div className={styles.strengthTrack}>
                  <div
                    className={styles.strengthFill}
                    style={{ width: `${(strength / 4) * 100}%`, background: STRENGTH_COLORS[strength] }}
                  />
                </div>
                <span className={styles.strengthLabel} style={{ color: STRENGTH_COLORS[strength] }}>
                  {pw ? STRENGTH_NAMES[strength] : "Nothing yet"}
                </span>
              </div>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Type it again</span>
              <input
                type={show ? "text" : "password"}
                value={repeatPw}
                onChange={(e) => setRepeatPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !blocker) submit();
                }}
                placeholder="Same again"
                autoComplete="new-password"
                className={styles.idInput}
                style={{ fontSize: 18, textTransform: "none" }}
              />
            </label>

            <button type="button" className={styles.toggleBothBtn} onClick={() => setShow((v) => !v)}>
              {show ? "Hide" : "Show"} both
            </button>

            <button type="button" className={styles.checkRow} onClick={() => setStay((v) => !v)}>
              <span className={`${styles.checkMark} ${stay ? styles.checked : ""}`}>{stay ? "✓" : ""}</span>
              <span className={styles.checkLabel}>Stay signed in on this computer</span>
            </button>

            <button
              type="button"
              disabled={!!blocker || busy}
              onClick={submit}
              className={styles.submitBtn}
              style={blocker || busy ? { background: "var(--disabled-btn)", opacity: 0.75 } : undefined}
            >
              {busy ? "Creating account…" : "Create my account"}
            </button>
            <div className={styles.changeNote} style={{ color: blocker || error ? "var(--danger)" : "var(--ink-faint)" }}>
              {blocker || error || "Saved to your account only. Write your password down somewhere safe."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
