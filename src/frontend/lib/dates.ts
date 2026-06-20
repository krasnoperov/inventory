// Centralized date formatting. Everything is pinned to `timeZone: 'UTC'` and a
// fixed `en-US` locale so the SSR render (Cloudflare Worker, UTC) and the client
// render (user's local timezone/locale) produce identical text. Without this,
// timestamps near a day boundary format to a different calendar day on each side
// and trigger a React hydration mismatch (#418) on SSR'd pages.
//
// For dates that are *intentionally* client-local (e.g. a "today" line), don't
// use these helpers — render with `suppressHydrationWarning` instead.

type DateInput = number | string | Date;

const UTC_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const UTC_MONTH_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function parseDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** e.g. "Jun 20, 2026". Returns '' for an unparseable value. */
export function formatUtcDate(value: DateInput): string {
  const date = parseDate(value);
  return date ? UTC_DATE_FORMATTER.format(date) : '';
}

/** e.g. "Jun 20". Returns '' for an unparseable value. */
export function formatUtcMonthDay(value: DateInput): string {
  const date = parseDate(value);
  return date ? UTC_MONTH_DAY_FORMATTER.format(date) : '';
}
