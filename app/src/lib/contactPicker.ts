/** The W3C Contact Picker API — lets a page ask for one contact from the
 * phone's own address book via a native, one-time picker (no standing
 * permission). Android Chrome only: not iOS Safari, not iOS Chrome (every
 * browser on iOS runs on Safari's engine under the hood), not desktop.
 * Every caller must hide whatever button triggers this behind
 * isContactPickerSupported() rather than assuming it exists. */
interface ContactInfo {
  name?: string[];
  tel?: string[];
}
interface ContactsManager {
  select(properties: string[], options?: { multiple?: boolean }): Promise<ContactInfo[]>;
}

export function isContactPickerSupported(): boolean {
  return typeof navigator !== "undefined" && "contacts" in navigator && typeof window !== "undefined" && "ContactsManager" in window;
}

/** Must be called directly from a click handler — the browser silently
 * refuses if it isn't a fresh user gesture. Returns null if the person
 * cancelled, the browser refused, or the contact had no phone number;
 * never throws, so callers don't need their own try/catch. */
export async function pickContact(): Promise<{ name: string; tel: string } | null> {
  if (!isContactPickerSupported()) return null;
  try {
    const mgr = (navigator as unknown as { contacts: ContactsManager }).contacts;
    const [contact] = await mgr.select(["name", "tel"], { multiple: false });
    if (!contact?.tel?.[0]) return null;
    return { name: contact.name?.[0]?.trim() ?? "", tel: contact.tel[0].trim() };
  } catch {
    return null;
  }
}
