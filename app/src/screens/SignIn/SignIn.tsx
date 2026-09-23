import { useState } from "react";
import styles from "./SignIn.module.css";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useAuth } from "../../context/AuthContext";
import {
  getRememberedAccount,
  clearRememberedDevice,
  signIn,
  setPassword,
  type SignInError,
  type ChangePasswordError,
} from "../../api/auth";
import type { Account } from "../../api/types";
import { strengthOf, STRENGTH_NAMES, STRENGTH_COLORS } from "../../lib/passwordStrength";

const ERROR_TEXT: Record<SignInError, string> = {
  empty_id: "Type your employee ID.",
  unknown_id: "No account with that employee ID. Check it with your team lead.",
  empty_password: "Type your password.",
  wrong_password: "That password does not match. A superadmin can reset it for you.",
  locked: "Too many wrong passwords. Sign-in is paused for 15 minutes, or a superadmin can reset it now.",
  network: "Couldn't reach the server. Check your connection and try again.",
};

const CHANGE_ERROR_TEXT: Record<ChangePasswordError, string> = {
  too_short: "At least 8 characters.",
  same_as_issued: "Pick something different from the one you were given.",
  network: "Couldn't reach the server. Check your connection and try again.",
};

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2);
}

export function SignIn() {
  const { refresh, realUser } = useAuth();
  // Signed in with a temporary password, then reloaded before changing it:
  // the server still refuses everything else, so pick up at the change step.
  const pendingFromSession = realUser?.mustChangePassword ? realUser : null;
  const narrow = useMediaQuery("(max-width: 560px)");
  const deviceWord = narrow ? "phone" : "computer";

  const [remembered, setRemembered] = useState(() => getRememberedAccount());
  const rememberedAccount = remembered;

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [stay, setStay] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [stage, setStage] = useState<"signin" | "change">(pendingFromSession ? "change" : "signin");
  const [pendingAccount, setPendingAccount] = useState<Account | null>(pendingFromSession);
  const [newPw, setNewPw] = useState("");
  const [repeatPw, setRepeatPw] = useState("");
  const [saveError, setSaveError] = useState("");

  async function attempt() {
    const targetId = rememberedAccount ? rememberedAccount.employeeId : id;
    setBusy(true);
    const result = await signIn(targetId, pw, stay);
    setBusy(false);
    if (!result.ok) {
      setError(ERROR_TEXT[result.error]);
      return;
    }
    setError("");
    setPw("");
    if (result.account.mustChangePassword) {
      setPendingAccount(result.account);
      setStage("change");
    } else {
      refresh();
    }
  }

  const strength = strengthOf(newPw);
  const changeBlocker = !pendingAccount
    ? ""
    : newPw.length < 8
      ? "At least 8 characters."
      : !repeatPw
        ? "Type it a second time."
        : repeatPw !== newPw
          ? "The two do not match."
          : "";

  async function saveNewPassword() {
    if (!pendingAccount || changeBlocker) return;
    setSaveError("");
    setBusy(true);
    const result = await setPassword(pendingAccount, newPw, stay);
    setBusy(false);
    if (!result.ok) {
      setSaveError(CHANGE_ERROR_TEXT[result.error]);
      return;
    }
    refresh();
  }

  if (stage === "change" && pendingAccount) {
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
              <span className={styles.pillText}>First time signing in</span>
            </div>
            <h1 className={styles.heading} style={{ marginTop: 14 }}>
              Pick your own password
            </h1>
            <div className={styles.subNote}>
              The one you were given stops working after this. Nobody can read the new one back — not even a
              superadmin.
            </div>

            <div className={styles.fields}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>New password</span>
                <input
                  type={show ? "text" : "password"}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !changeBlocker) saveNewPassword();
                  }}
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
                    {newPw ? STRENGTH_NAMES[strength] : "Nothing yet"}
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
                    if (e.key === "Enter" && !changeBlocker) saveNewPassword();
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

              <button
                type="button"
                disabled={!!changeBlocker || busy}
                onClick={saveNewPassword}
                className={styles.submitBtn}
                style={
                  changeBlocker || busy
                    ? { background: "var(--disabled-btn)", opacity: 0.75 }
                    : undefined
                }
              >
                {busy ? "Saving…" : "Save it and start work"}
              </button>
              <div
                className={styles.changeNote}
                style={{ color: changeBlocker || saveError ? "var(--danger)" : "var(--ink-faint)" }}
              >
                {changeBlocker || saveError || "Saved on your account only. Write it somewhere safe."}
              </div>
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
          <h1 className={styles.heading}>
            {rememberedAccount ? `Welcome back, ${rememberedAccount.name.split(" ")[0]}` : "Sign in"}
          </h1>
          <div className={styles.subNote}>
            {rememberedAccount
              ? `Just your password — this ${deviceWord} remembers who you are.`
              : "Use the employee ID your team lead gave you. There is no email address to remember."}
          </div>

          <div className={styles.fields}>
            {!rememberedAccount && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Employee ID</span>
                <input
                  value={id}
                  onChange={(e) => {
                    setId(e.target.value);
                    setError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") attempt();
                  }}
                  placeholder="NUSRAT_002"
                  autoComplete="username"
                  className={`${styles.idInput} ${error ? styles.errored : ""}`}
                />
              </label>
            )}

            {rememberedAccount && (
              <div className={styles.knownDevice}>
                <span className={styles.avatar}>{initials(rememberedAccount.name)}</span>
                <div style={{ minWidth: 0 }}>
                  <div className={styles.deviceName}>{rememberedAccount.name}</div>
                  <div className={styles.deviceId}>
                    {rememberedAccount.employeeId} · {rememberedAccount.roleLabel}
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.notMeBtn}
                  onClick={() => {
                    clearRememberedDevice();
                    setRemembered(null);
                    setId("");
                    setPw("");
                    setError("");
                  }}
                >
                  Not me
                </button>
              </div>
            )}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Password</span>
              <div className={styles.pwRow}>
                <input
                  type={show ? "text" : "password"}
                  value={pw}
                  onChange={(e) => {
                    setPw(e.target.value);
                    setError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") attempt();
                  }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className={`${styles.pwInput} ${error ? styles.errored : ""}`}
                />
                <button type="button" className={styles.pwToggle} onClick={() => setShow((v) => !v)}>
                  {show ? "Hide" : "Show"}
                </button>
              </div>
            </label>

            {error && <div className={styles.errorBox}>{error}</div>}

            <button type="button" className={styles.checkRow} onClick={() => setStay((v) => !v)}>
              <span className={`${styles.checkMark} ${stay ? styles.checked : ""}`}>{stay ? "✓" : ""}</span>
              <span className={styles.checkLabel}>Stay signed in on this {deviceWord}</span>
            </button>

            <button type="button" disabled={busy} onClick={attempt} className={`${styles.submitBtn} ${busy ? styles.busy : ""}`}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>

          <div className={styles.footer}>
            Forgotten it? A superadmin resets it for you — there is no email link. Ask your team lead.
          </div>
        </div>
      </div>
    </div>
  );
}
