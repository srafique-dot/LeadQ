import { useState } from "react";
import { Requester } from "./Requester/Requester";
import { Agent } from "./Agent/Agent";
import { Supervisor } from "./Supervisor/Supervisor";
import { Users } from "./Users/Users";

type Screen = "leads" | "queue" | "floor" | "people";

const TABS: { key: Screen; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "queue", label: "Call queue" },
  { key: "floor", label: "Floor view" },
  { key: "people", label: "People & access" },
];

/** Only superadmin lands here — the one role the README's own table says
 * "sees Everything." Every other role is locked to its single screen by
 * design; this is a thin switcher, not a general nav shell. */
export function SuperadminShell() {
  const [screen, setScreen] = useState<Screen>("people");

  return (
    <div>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "#16232A",
          display: "flex",
          gap: 4,
          padding: "6px 10px",
        }}
      >
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
      {screen === "leads" && <Requester />}
      {screen === "queue" && <Agent />}
      {screen === "floor" && <Supervisor />}
      {screen === "people" && <Users />}
    </div>
  );
}
