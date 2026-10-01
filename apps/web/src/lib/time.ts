/**
 * Time as the reader's laboratory keeps it.
 *
 * A console that says "good evening" to someone at 9am has told them the
 * software does not know where they are, which is the first thing a researcher
 * notices and the last thing they forget. So the time zone is an IANA name, not
 * a UTC offset: an offset is wrong twice a year, and the whole point of the
 * greeting is to be right about the reader's morning.
 */

/** The bands. 5am starts the morning, noon the afternoon, 5pm the evening, and
 *  the evening runs through the night rather than becoming a fourth band that
 *  would tell someone at 2am that it is morning. */
export type Greeting = "Good morning" | "Good afternoon" | "Good evening";

export function greetingForHour(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The hour in a zone, read through Intl rather than by adding an offset, so a
 *  daylight-saving change is the platform's problem and not this file's. */
export function hourIn(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(date);
  // "24" appears in some ICU versions for midnight.
  return Number(hour) % 24;
}

export function greetingIn(date: Date, timeZone: string): Greeting {
  return greetingForHour(hourIn(date, timeZone));
}

/** "6:26 PM EDT". The zone abbreviation is included because it is the part that
 *  tells a collaborator in another country which clock this is. */
export function clockIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/** Whether a string is a time zone this runtime can actually format in. A
 *  stored zone can be stale, misspelled, or come from a cookie somebody edited,
 *  and `Intl` throws on an unknown one. */
export function isValidTimeZone(timeZone: string | undefined | null): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/** The cookie the console uses to remember the reader's zone between requests,
 *  so the server can render the right greeting instead of guessing and
 *  correcting it after hydration. */
export const TIME_ZONE_COOKIE = "splicr_tz";

/** The zone used when nothing better is known. UTC is the honest default: it is
 *  not a guess about where the reader is. */
export const FALLBACK_TIME_ZONE = "UTC";
