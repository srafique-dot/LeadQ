/** Superadmin-editable SMS templates. No SMS gateway exists — LeadQ only
 * generates the text; the agent copies it into their own phone's SMS app.
 * Backed by api/channels/index.ts's settings dispatch (see that file for why). */
export type SmsTemplateKey = "sms_missed_call" | "sms_callback_confirm" | "sms_booking_confirm";

export function getSettings(): Promise<Record<string, string>> {
  return fetch("/api/channels?resource=settings").then((r) => r.json());
}

export async function setSetting(key: SmsTemplateKey, value: string, updatedBy: string): Promise<void> {
  const res = await fetch("/api/channels?action=set-setting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value, updatedBy }),
  });
  if (!res.ok) throw new Error("Could not save the template.");
}

/** Fills {token} placeholders; anything left unfilled (an agent left it in
 * the template, or the lead has no value for it) is dropped rather than
 * left as a literal "{doctor}" in the text someone actually sends. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => values[key] ?? "").replace(/\s{2,}/g, " ").trim();
}
