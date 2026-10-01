/* How a researcher is addressed. Pure functions, no rendering. */
import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const { displayName, greetingName, personInitials } = loadTs("lib/people.ts");

test("a title turns the greeting formal, and takes the full name with it", () => {
  assert.equal(greetingName({ fullName: "Maya Chen", preferredTitle: "Dr." }), "Dr. Maya Chen");
  assert.equal(greetingName({ fullName: "Ana Rivera", preferredTitle: "Professor" }), "Professor Ana Rivera");
});

test("no title means the first name alone", () => {
  assert.equal(greetingName({ fullName: "Sahaj Satani" }), "Sahaj");
  assert.equal(greetingName({ fullName: "Sahaj Satani", preferredTitle: "  " }), "Sahaj");
});

test("a professional role is not an honorific and never reaches the greeting", () => {
  // The only defence is that there is nowhere to pass one: `greetingName` reads
  // `preferredTitle` and nothing else, so a role cannot arrive by accident.
  const person = { fullName: "Maya Chen", preferredTitle: null };
  assert.equal(greetingName({ ...person, professionalRole: "Research Scientist" }), "Maya");
});

test("an unknown reader is greeted without a name rather than with a blank", () => {
  assert.equal(greetingName({}), "");
  assert.equal(greetingName({ fullName: "   " }), "");
});

test("an address stands in for a missing name", () => {
  assert.equal(displayName({ email: "ss4497@example.edu" }), "ss4497");
  assert.equal(greetingName({ email: "ss4497@example.edu" }), "ss4497");
});

test("initials come from the name, not the title", () => {
  assert.equal(personInitials({ fullName: "Maya Chen", preferredTitle: "Dr." }), "MC");
  assert.equal(personInitials({ fullName: "Sahaj Satani" }), "SS");
  assert.equal(personInitials({ fullName: "Rosalind" }), "RO");
  assert.equal(personInitials({}), "?");
});
