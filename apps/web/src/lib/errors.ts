/**
 * What a researcher is told when something fails.
 *
 * Two rules, and everything here follows from them.
 *
 * The first is that the message says what happened to their data. "Something
 * went wrong" leaves a person wondering whether the invitation went out twice,
 * whether the run started, whether to try again. So each message below says
 * what the system did or did not do, and only then what to do next.
 *
 * The second is that a message never carries the underlying text. A Postgres
 * constraint name, a Supabase internal string or a fetch failure is written for
 * whoever is reading the logs, not for the person at the keyboard: at best it is
 * noise, and at worst it describes the schema to someone who should not see it.
 * The original belongs in a server log, with a reference the reader can quote.
 */

/** A failure as the interface presents it. */
export type Problem = {
  /** One sentence. What happened, and what it did or did not change. */
  message: string;
  /** What the reader can do, when there is something. */
  action?: string;
};

/** Neither confirms nor denies that an address has an account. Used for every
 *  response to "email me a link" and "reset my password", success or failure,
 *  so the form cannot be used to find out who has an account. */
export const NEUTRAL_EMAIL_RESULT =
  "If this address belongs to an active SplicR account, a one-time code is on its way.";

const AUTH_MESSAGES: Array<[RegExp, Problem]> = [
  [
    /invalid login credentials/i,
    { message: "That email and password do not match an account.", action: "Check the address, or reset your password." },
  ],
  [
    /email not confirmed/i,
    {
      message: "This address has not been confirmed yet.",
      action: "Enter the code from the most recent SplicR email.",
    },
  ],
  [
    /(over_email_send_rate_limit|rate limit|too many requests)/i,
    { message: "Too many attempts in a short time. Nothing was changed.", action: "Wait a minute and try again." },
  ],
  [
    /signups? not allowed|signup is disabled|otp_disabled/i,
    {
      message: "Access to SplicR is by invitation.",
      action: "Ask your lab administrator to invite this address.",
    },
  ],
  [
    /(token has expired|expired|invalid token|otp_expired)/i,
    { message: "That code has expired, is incorrect, or has already been used.", action: "Request a new one." },
  ],
  [
    /user already registered|already been registered/i,
    { message: "An account already exists for this address.", action: "Sign in instead." },
  ],
  [
    /password.*(at least|should be|weak)/i,
    { message: "That password is too short.", action: "Use at least eight characters." },
  ],
  [
    /(failed to fetch|networkerror|load failed)/i,
    {
      message: "SplicR could not reach the sign-in service. Nothing was changed.",
      action: "Check your connection and try again.",
    },
  ],
];

/**
 * Turns whatever the auth client threw into something worth reading.
 *
 * Anything unrecognised gets the generic line rather than its own text, because
 * an unrecognised error is exactly the case where the underlying string is most
 * likely to be an internal one.
 */
export function authProblem(error: unknown): Problem {
  const raw =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "");

  for (const [pattern, problem] of AUTH_MESSAGES) {
    if (pattern.test(raw)) return problem;
  }

  return {
    message: "SplicR could not complete that request. Nothing was changed.",
    action: "Try again in a moment.",
  };
}

/** The same idea for writes inside the console. */
const WRITE_MESSAGES: Array<[RegExp, Problem]> = [
  [/23505|duplicate key|already exists/i, { message: "That already exists here." }],
  [
    /23503|foreign key/i,
    { message: "That record refers to something that is no longer here. Nothing was changed." },
  ],
  [
    /(permission denied|row-level security|42501|not authorized)/i,
    {
      message: "You do not have permission to make that change.",
      action: "Ask an owner or admin of this lab.",
    },
  ],
  [
    /(failed to fetch|networkerror|load failed|timeout)/i,
    { message: "SplicR could not reach the database. Nothing was changed.", action: "Try again in a moment." },
  ],
];

export function writeProblem(error: unknown): Problem {
  const raw =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "");
  for (const [pattern, problem] of WRITE_MESSAGES) {
    if (pattern.test(raw)) return problem;
  }
  return { message: "That change could not be saved. Nothing was changed.", action: "Try again in a moment." };
}
