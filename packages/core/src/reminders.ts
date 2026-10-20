/**
 * Reminders the widget app shows itself as a system notification, without any calendar. They live in the
 * app's own storage, so they need the widget running (it starts with Windows) and fire late, not never:
 * a reminder missed while the computer was off is shown at the next start.
 */
export interface Reminder {
  id: string;
  text: string;
  /** ISO instant. */
  at: string;
}

/** `date` (`YYYY-MM-DD`) and `time` (`HH:MM`) in local time → ISO instant. */
export function reminderInstant(date: string, time: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y ?? 1970, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0).toISOString();
}

/** Splits reminders into those due now and the rest, both sorted by time. */
export function splitDue(reminders: Reminder[], now: Date = new Date()): { due: Reminder[]; upcoming: Reminder[] } {
  const sorted = [...reminders].sort((a, b) => a.at.localeCompare(b.at));
  return {
    due: sorted.filter((r) => Date.parse(r.at) <= now.getTime()),
    upcoming: sorted.filter((r) => Date.parse(r.at) > now.getTime()),
  };
}

/** Tolerant parse of the stored list: anything malformed is dropped. */
export function parseReminders(json: string | null): Reminder[] {
  try {
    const data = JSON.parse(json ?? "[]") as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (r): r is Reminder =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as Reminder).id === "string" &&
        typeof (r as Reminder).text === "string" &&
        !Number.isNaN(Date.parse((r as Reminder).at)),
    );
  } catch {
    return [];
  }
}
