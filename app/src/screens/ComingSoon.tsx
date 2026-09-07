import { useAuth } from "../context/AuthContext";

const DEST: Record<string, string> = {
  agent: "the call queue",
  admin: "the floor view",
  superadmin: "people & access",
};

/** Sign-in supports every role from the handoff, but this build only
 * implements the requester screen — this is an honest placeholder for the
 * other three rather than pretending they exist. */
export function ComingSoon() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
          {user.roleLabel} isn’t built yet
        </h1>
        <p style={{ color: "var(--ink-muted)", fontSize: 14, lineHeight: 1.6, marginTop: 10 }}>
          You’re signed in as {user.name} ({user.employeeId}). This preview only implements the requester
          screen — {DEST[user.role] ?? "this role's screen"} is next.
        </p>
        <button
          type="button"
          onClick={signOut}
          style={{
            marginTop: 16,
            background: "var(--surface)",
            border: "1px solid var(--border-input)",
            color: "var(--ink-muted)",
            borderRadius: 8,
            padding: "12px 18px",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
