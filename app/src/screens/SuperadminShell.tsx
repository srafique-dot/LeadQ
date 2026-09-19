import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import type { Role } from "../api/types";
import { Requester } from "./Requester/Requester";
import { Agent } from "./Agent/Agent";
import { Supervisor } from "./Supervisor/Supervisor";
import { Users } from "./Users/Users";

type Screen = "leads" | "queue" | "floor" | "people";

const SCREEN_KEY = "umch.superadminTab";
const VALID_SCREENS: Screen[] = ["leads", "queue", "floor", "people"];

function loadStoredScreen(): Screen {
  const stored = localStorage.getItem(SCREEN_KEY);
  return VALID_SCREENS.includes(stored as Screen) ? (stored as Screen) : "people";
}

const TABS: { key: Screen; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "queue", label: "Call queue" },
  { key: "floor", label: "Floor view" },
  { key: "people", label: "People & access" },
];

const TAB_FOR_ROLE: Record<Role, Screen> = {
  requester: "leads",
  agent: "queue",
  admin: "floor",
  superadmin: "people",
};

/** Only superadmin lands here — the one role the README's own table says
 * "sees Everything." The tab strip switches between the four existing
 * screens; the "View as" picker lets superadmin see any of them exactly as
 * a specific person would (their own leads, their own queue identity),
 * by overriding AuthContext's `user` for the whole subtree — no screen
 * needed to change to support it. */
export function SuperadminShell() {
  const { realUser, accounts: allAccounts, viewAsId, setViewAs } = useAuth();
  const [screen, setScreenState] = useState<Screen>(loadStoredScreen);

  function setScreen(s: Screen) {
    setScreenState(s);
    localStorage.setItem(SCREEN_KEY, s);
  }

  if (!realUser) return null;

  const accounts = allAccounts.filter((a) => a.employeeId !== realUser.employeeId);
  const viewedAccount = viewAsId ? accounts.find((a) => a.employeeId === viewAsId) : null;

  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "#16232A",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 10px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setScreen(t.key)}
              style={{
                background: screen === t.key ? "#0E7C86" : "transparent",
                color: screen === t.key ? "#fff" : "#B4C2C6",
                border: "none",
                borderRadius: 6,
                padding: "7px 13px",
                fontSize: 12.5,
                fontWeight: 600,
                fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#8B9CA3", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>View as</span>
          <select
            value={viewAsId ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              setViewAs(id);
              if (id) {
                const acc = accounts.find((a) => a.employeeId === id);
                if (acc) setScreen(TAB_FOR_ROLE[acc.role]);
              }
            }}
            style={{
              background: "#243138",
              color: "#fff",
              border: "1px solid #3A4A52",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 12.5,
              fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
            }}
          >
            <option value="">Superadmin (you)</option>
            {accounts.map((a) => (
              <option key={a.employeeId} value={a.employeeId}>
                {a.name} · {a.employeeId} · {a.roleLabel}
              </option>
            ))}
          </select>
        </div>
      </div>

      {viewedAccount && (
        <div
          style={{
            background: "#FDF9EE",
            borderBottom: "1px solid #EBDCB4",
            padding: "8px 16px",
            fontSize: 13,
            color: "#7A4E06",
            fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>
            Viewing as <strong>{viewedAccount.name}</strong> ({viewedAccount.employeeId}) — every screen shows their data, not yours.
          </span>
          <button
            type="button"
            onClick={() => setViewAs(null)}
            style={{
              marginLeft: "auto",
              background: "#fff",
              border: "1px solid #E0C98F",
              color: "#7A4E06",
              borderRadius: 6,
              padding: "5px 11px",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Back to Superadmin
          </button>
        </div>
      )}

      {screen === "leads" && <Requester />}
      {screen === "queue" && <Agent />}
      {screen === "floor" && <Supervisor />}
      {screen === "people" && <Users />}
    </div>
  );
}
