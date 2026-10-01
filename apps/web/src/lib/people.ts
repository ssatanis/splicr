/**
 * How SplicR addresses a researcher.
 *
 * Two fields, deliberately kept apart, because conflating them produces the one
 * thing this has to avoid:
 *
 *   preferred_title    Dr., Professor, Prof.
 *   professional_role  Research Scientist, Postdoctoral Fellow, PI
 *
 * Only the title belongs in a greeting. "Good evening, Research Scientist Maya
 * Chen" is what happens when a product treats a job description as an
 * honorific, and it reads as a form letter from the first word.
 *
 * With a title, the greeting uses the full name, because "Dr. Maya" is a
 * strange middle ground that is neither formal nor familiar. Without one, it
 * uses the first name, because "Good evening, Sahaj Satani" is a summons.
 */

export type Person = {
  fullName?: string | null;
  /** An honorific the researcher chose, or nothing. Never inferred. */
  preferredTitle?: string | null;
  email?: string | null;
};

/** Titles are stored as the researcher typed them, then tidied at the edges:
 *  a stray trailing comma or a doubled space should not reach a greeting. */
const clean = (value: string | null | undefined) => value?.trim().replace(/\s+/g, " ").replace(/,$/, "") ?? "";

/** The name on a profile, a member row, a report signature. */
export function displayName(person: Person): string {
  const name = clean(person.fullName);
  if (name) return name;
  const local = clean(person.email).split("@")[0];
  return local || "";
}

/**
 * The name in the greeting.
 *
 * Returns an empty string when SplicR does not know who is reading, so the
 * caller can render "Good evening" on its own rather than greeting a blank.
 */
export function greetingName(person: Person): string {
  const name = displayName(person);
  if (!name) return "";

  const title = clean(person.preferredTitle);
  if (title) return `${title} ${name}`;

  return name.split(" ")[0] ?? name;
}

/** Initials for an avatar. Two letters at most, from the name rather than the
 *  title: "Dr. Maya Chen" is MC, not DM. */
export function personInitials(person: Person): string {
  const parts = displayName(person).split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
