import type { Channel } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${url}`);
  return res.json();
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed: ${url}`);
  return json;
}

export function listChannels(): Promise<Channel[]> {
  return getJson("/api/channels");
}

export function createChannel(name: string, createdBy: string): Promise<Channel> {
  return postJson("/api/channels", { name, createdBy });
}

export function setChannelActive(name: string, active: boolean): Promise<Channel> {
  return postJson("/api/channels?action=toggle", { name, active });
}

/** Leads already tagged with this channel keep that text regardless —
 * this only removes it from the list offered on new leads. */
export async function deleteChannel(name: string): Promise<void> {
  await postJson("/api/channels?action=delete", { name });
}
