/**
 * "To calendar" mode: a capture becomes an event in the user's Google Calendar.
 *
 * Transport: a small Google Apps Script web app that the user deploys once in their own Google account
 * (`appsScriptSource` below). It runs as the user, so ArchiVarious needs no Google Cloud project, no OAuth
 * and no server of its own; the hosts just POST the event as JSON. The script URL is private to the user,
 * and every request also carries a random key that the script checks.
 */

/** Date and time as the user picked them, in their local time zone. */
export interface EventWhen {
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:MM`; omitted for an all-day event. */
  time?: string;
  /** Length of a timed event. */
  minutes: number;
}

/** What is sent to the script. Timed events carry ISO instants; all-day events carry plain dates. */
export interface CalendarEvent {
  title: string;
  description: string;
  allDay: boolean;
  /** ISO instant, or `YYYY-MM-DD` for an all-day event. */
  start: string;
  /** ISO instant (exclusive end), or `YYYY-MM-DD` for an all-day event (same day). */
  end: string;
}

export const DEFAULT_EVENT_MINUTES = 60;
export const EVENT_DURATIONS = [15, 30, 60, 90, 120] as const;

/** Only deployed Apps Script web apps are accepted, so a typo can't send notes somewhere else. */
const APPS_SCRIPT_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

export function isAppsScriptUrl(url: string): boolean {
  return APPS_SCRIPT_URL_RE.test(url.trim());
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Pre-fills the date and time from the note text, so "позвонить маме завтра в 15:00" needs no picking.
 * Understands сегодня / завтра / послезавтра, `25.10`, `25.10.2026`, `15:00`, `в 15` and `в 9 утра`/`в 7 вечера`.
 * Without a time it suggests the next full hour today (or 9:00 on another day).
 */
export function suggestWhen(text: string, now: Date = new Date()): EventWhen {
  let lower = text.toLowerCase();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let dated = false;

  if (/послезавтра/.test(lower)) {
    day.setDate(day.getDate() + 2);
    dated = true;
  } else if (/завтра/.test(lower)) {
    day.setDate(day.getDate() + 1);
    dated = true;
  } else {
    const m = /(?:^|[^\d])(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?(?![\d.])/.exec(lower);
    const d = Number(m?.[1]);
    const mo = Number(m?.[2]);
    if (m && d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : day.getFullYear();
      // "25.01" written in December means next January.
      if (!m[3] && new Date(year, mo - 1, d) < day) year++;
      day.setFullYear(year, mo - 1, d);
      dated = true;
      // "25.10" must not be read again as the time 25:10.
      lower = lower.replace(m[0], " ");
    }
  }

  let time: string | undefined;
  const clock = [...lower.matchAll(/(?:^|[^\d.])(\d{1,2})[:.](\d{2})(?![\d.])/g)].find(
    (c) => Number(c[1]) < 24 && Number(c[2]) < 60,
  );
  const hourOnly = /(?:^|\s)в\s+(\d{1,2})(?:\s*(утра|дня|вечера|ночи|ч\b|час))?(?![\d:.])/.exec(lower);
  if (clock) {
    time = `${pad(Number(clock[1]))}:${clock[2]}`;
  } else if (hourOnly) {
    let h = Number(hourOnly[1]);
    if ((hourOnly[2] === "дня" || hourOnly[2] === "вечера") && h < 12) h += 12;
    if (h < 24) time = `${pad(h)}:00`;
  }

  if (!time) {
    const sameDay = isoDate(day) === isoDate(now);
    time = sameDay && !dated ? `${pad((now.getHours() + 1) % 24)}:00` : "09:00";
    if (sameDay && !dated && now.getHours() === 23) day.setDate(day.getDate() + 1);
  }
  return { date: isoDate(day), time, minutes: DEFAULT_EVENT_MINUTES };
}

/** The event for a capture: the formatted title, and the note text as the description. */
export function buildCalendarEvent(title: string, body: string, when: EventWhen): CalendarEvent {
  const description = `${body.trim()}\n\n— ArchiVarious`;
  if (!when.time) return { title, description, allDay: true, start: when.date, end: when.date };
  const [y, mo, d] = when.date.split("-").map(Number);
  const [h, mi] = when.time.split(":").map(Number);
  const start = new Date(y ?? 1970, (mo ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
  const end = new Date(start.getTime() + Math.max(5, when.minutes) * 60_000);
  return { title, description, allDay: false, start: start.toISOString(), end: end.toISOString() };
}

/** Request body for the script. Sent as `text/plain` so browsers don't need a CORS preflight. */
export function calendarRequestBody(event: CalendarEvent, key: string): string {
  return JSON.stringify({ key, ...event });
}

/** The script's JSON reply: `{ ok: true, id }` or `{ ok: false, error }`. Anything else is reported as an error. */
export function parseCalendarResponse(text: string): { ok: true } | { ok: false; error: string } {
  try {
    const data = JSON.parse(text) as { ok?: unknown; error?: unknown };
    if (data.ok === true) return { ok: true };
    return { ok: false, error: typeof data.error === "string" ? data.error : "скрипт вернул ошибку" };
  } catch {
    // Google answers with an HTML page when the script isn't deployed for "Anyone" or the URL is wrong.
    return { ok: false, error: "скрипт не ответил. Проверь адрес и что доступ открыт для «Все»" };
  }
}

/** The Apps Script the user pastes into script.google.com. `key` is generated by the host and stored in its settings. */
export function appsScriptSource(key: string): string {
  return `// ArchiVarious → Google Календарь.
// 1. Вставь этот код на https://script.google.com (Новый проект) вместо всего, что там есть, и сохрани.
// 2. «Начать развертывание» → «Новое развертывание» → тип «Веб-приложение».
//    Выполнять как: «От моего имени». У кого есть доступ: «Все». Нажми «Начать развертывание» и разреши доступ к календарю.
// 3. Скопируй адрес веб-приложения (заканчивается на /exec) и вставь его в настройки ArchiVarious.
// Ключ ниже должен совпадать с ключом в настройках ArchiVarious: без него скрипт ничего не создаёт.
const KEY = ${JSON.stringify(key)};

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.key !== KEY) return reply({ ok: false, error: "неверный ключ" });
    const calendar = CalendarApp.getDefaultCalendar();
    const options = { description: String(data.description || "") };
    let event;
    if (data.allDay) {
      const [y, m, d] = String(data.start).split("-").map(Number);
      event = calendar.createAllDayEvent(String(data.title), new Date(y, m - 1, d), options);
    } else {
      event = calendar.createEvent(String(data.title), new Date(data.start), new Date(data.end), options);
    }
    return reply({ ok: true, id: event.getId() });
  } catch (error) {
    return reply({ ok: false, error: String(error) });
  }
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
`;
}
