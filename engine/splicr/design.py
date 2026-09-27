"""
Screen design: sample roles, and whether the requested contrast makes sense.

This module exists because the two things a lab gets wrong most often are not
in the biology or the statistics, they are in the metadata: which sample is the
library reference, and which way round the contrast goes. Both used to pass
straight through the engine and change the answer silently.

Three jobs:

1. Roles are a closed set. `public.sample_role` in the database is an enum of
   exactly ('plasmid', 'reference', 'control', 'treatment'), so anything the
   engine accepts and anything it persists has to come from that set. A role
   of "Plasmid" or "library" used to be accepted, silently fail every
   `role == "plasmid"` test and change which contrast NNMD was measured on.

2. Roles can be inferred from sample labels, and are, when the caller gives
   none. A plasmid pool or a T0 sample is almost always named as one, and
   guessing "control" for it, which is what the CLI used to do, is worse than
   guessing from the name: it made the plasmid pool a control arm and left the
   screen with no library reference at all, so NNMD, AUROC and the essentiality
   check did not run on the most common design in the product.

3. A design can be internally contradictory, and those contradictions are
   cheap to detect before anything expensive runs. A mistyped --treatment
   label used to survive QC, silently analyse fewer replicates than the lab
   thought, and then kill MAGeCK with exit 255 after counting had already run.
   Swapping --treatment and --control used to produce a confident, fully
   inverted gene list with the ribosome and the proteasome called enriched.

Label patterns are deliberately narrow. Over-matching here is worse than
under-matching, because a wrong inferred role changes the analysis while an
absent one only asks the caller a question.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# The database enum, verbatim from
# supabase/migrations/20260926000200_schemas_types_helpers.sql:27
ROLES: tuple[str, ...] = ("plasmid", "reference", "control", "treatment")

# Roles that mark a sample as a library reference rather than an endpoint: the
# denominator a dropout contrast measures against, never its numerator.
REFERENCE_ROLES: tuple[str, ...] = ("plasmid", "reference")


class DesignError(ValueError):
    """A design that cannot be analysed as stated. Always names the fix."""


# ---------------------------------------------------------------------------
# Label patterns
#
# Naming conventions in public archives, which is where the vocabulary labs
# actually use can be read off. The samples of GSE145743 (Juhasz et al. 2020)
# are named `libA_plasmid`, `libA_T0_input`, `libA_DMSO_rep1`; the Broad GPP
# submission guide asks for a "plasmid/pDNA" sample and an "early time point";
# BAGEL2's and MAGeCK's own worked examples use T0/Tn and "plasmid".
#
# Matched on the label with separators stripped, so `T0_input`, `T0-input` and
# `T0input` all behave the same.
# ---------------------------------------------------------------------------

# Substrings that mean the sample is the plasmid pool itself, sequenced before
# any cell saw it.
_PLASMID_SUBSTRINGS: tuple[str, ...] = (
    "plasmid", "pdna", "libpool", "librarypool", "poolplasmid", "plasmidpool",
)

# Substrings that mean "the earliest sample in this screen", i.e. the library
# as it went into the cells. "input" is included because that is the usual name
# for it in GEO submissions; it has no other meaning in a pooled screen.
_BASELINE_SUBSTRINGS: tuple[str, ...] = (
    "day0", "days0", "time0", "timepoint0", "tp0", "input", "baseline",
    "initial", "earlytimepoint", "preselection", "presort",
)

# Whole tokens that mean the same thing. Kept as tokens rather than substrings
# because "t0" and "d0" appear inside unrelated words; "lot0" and "med0" would
# otherwise both read as a T0 sample.
_BASELINE_TOKENS: frozenset[str] = frozenset({"t0", "d0", "tp0", "t00", "d00"})


def _compact(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", label.lower())


def _tokens(label: str) -> frozenset[str]:
    """
    Tokens of a label, including letter/digit recombinations.

    `libA_T0_input` splits on separators to {liba, t0, input}. `T0input` has no
    separators, so it is also split at the letter/digit boundaries into
    {t, 0, input} and adjacent pairs are rejoined to recover {t0, 0input}.
    Without the rejoin step, a label written without separators would not be
    recognised at all.
    """
    out: set[str] = set()
    for tok in re.split(r"[^a-z0-9]+", label.lower()):
        if not tok:
            continue
        out.add(tok)
        parts = re.findall(r"[a-z]+|[0-9]+", tok)
        if len(parts) > 1:
            out.update(parts)
            out.update(a + b for a, b in zip(parts, parts[1:]))
    return frozenset(out)


def looks_like_plasmid(label: str) -> bool:
    compact = _compact(label)
    return any(s in compact for s in _PLASMID_SUBSTRINGS)


def looks_like_baseline(label: str) -> bool:
    """
    True when the label names a library reference: the plasmid pool, or the
    earliest cell sample in the screen.

    Used to keep such a sample out of the numerator of anything. A baseline
    sample cannot be a dropout endpoint, because no dropout has happened yet,
    and it cannot be a treatment arm, because there was no treatment yet.
    """
    if looks_like_plasmid(label):
        return True
    compact = _compact(label)
    if any(s in compact for s in _BASELINE_SUBSTRINGS):
        return True
    return bool(_tokens(label) & _BASELINE_TOKENS)


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

@dataclass
class Design:
    """A validated screen design. Roles are guaranteed to be in ROLES."""

    roles: dict[str, str]
    treatment: list[str]
    control: list[str]
    # What was inferred or corrected, in the caller's words, so the run log and
    # the report can show it rather than the lab discovering it in the numbers.
    notes: list[str] = field(default_factory=list)

    @property
    def reference_samples(self) -> list[str]:
        return [s for s, r in self.roles.items() if r in REFERENCE_ROLES]

    def as_dict(self) -> dict:
        return {"roles": dict(self.roles), "treatment": list(self.treatment),
                "control": list(self.control), "notes": list(self.notes)}


def infer_roles(
    labels: list[str],
    treatment: list[str],
    control: list[str],
    explicit: dict[str, str] | None = None,
) -> tuple[dict[str, str], list[str]]:
    """
    Fill in a role for every sample, and say what was inferred.

    An explicit role always wins; this only fills gaps. The order of the rules
    matters:

    1. A label that names the plasmid pool is 'plasmid', and a label that names
       the screen's earliest sample is 'reference', whichever side of the
       contrast it was passed on. In a dropout design T0 is the denominator of
       the lab's own contrast, so deciding by the contrast lists alone would
       make it a 'control' arm and leave the screen without a reference. That
       is exactly the bug this replaces.
    2. Otherwise the contrast lists decide: numerator arms are 'treatment',
       denominator arms are 'control'.
    3. A sample in neither list and with no recognisable name is not given a
       role at all. Guessing there is what caused the original defect, and the
       caller can answer the question in one flag.
    """
    roles: dict[str, str] = {}
    notes: list[str] = []
    for label in labels:
        given = (explicit or {}).get(label)
        if given is not None:
            roles[label] = given
            continue
        if looks_like_plasmid(label):
            roles[label] = "plasmid"
            notes.append(f"{label} was not given a role; its name says plasmid pool, "
                         "so it is the library reference for QC.")
        elif looks_like_baseline(label):
            roles[label] = "reference"
            notes.append(f"{label} was not given a role; its name says the screen's "
                         "earliest sample, so it is treated as the T0 reference.")
        elif label in treatment:
            roles[label] = "treatment"
        elif label in control:
            roles[label] = "control"
    return roles, notes


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _near(label: str, candidates: list[str]) -> str | None:
    """
    Closest candidate label, for a typo message.

    Case-insensitive equality first, since that is the overwhelmingly common
    case (`D21_a` for `D21_A`), then a single edit.
    """
    for c in candidates:
        if c.lower() == label.lower():
            return c
    for c in candidates:
        if abs(len(c) - len(label)) <= 1 and _edits_within_one(label.lower(), c.lower()):
            return c
    return None


def _edits_within_one(a: str, b: str) -> bool:
    if a == b:
        return True
    if len(a) > len(b):
        a, b = b, a
    if len(b) - len(a) > 1:
        return False
    i = j = 0
    edited = False
    while i < len(a) and j < len(b):
        if a[i] != b[j]:
            if edited:
                return False
            edited = True
            if len(a) == len(b):
                i += 1
            j += 1
            continue
        i += 1
        j += 1
    return True


def build_design(
    labels: list[str],
    roles: dict[str, str] | None,
    treatment: list[str],
    control: list[str],
) -> Design:
    """
    Infer what is missing, then refuse anything self-contradictory.

    Raises DesignError with a message that names the offending label and the
    flag that fixes it. Everything here is checked before a single read is
    counted, because the whole point is to not spend three minutes counting a
    screen that cannot be analysed as stated.
    """
    if not labels:
        raise DesignError("no samples were supplied.")

    dupes = sorted({l for l in labels if labels.count(l) > 1})
    if dupes:
        raise DesignError(
            f"duplicate sample label(s) {dupes}. Every sample needs a distinct label: "
            "counts, QC and the contrast all key off it."
        )

    known = set(labels)

    # A role for a label that is not in the screen is a typo in --role, and it
    # would otherwise be silently dropped.
    for label in (roles or {}):
        if label not in known:
            hint = _near(label, labels)
            raise DesignError(
                f"--role names sample {label!r}, which is not in this screen."
                + (f" Did you mean {hint!r}?" if hint else f" Samples are {sorted(known)}.")
            )

    for label, role in (roles or {}).items():
        if role not in ROLES:
            hint = next((r for r in ROLES if r.lower() == str(role).lower()), None)
            raise DesignError(
                f"{label} has role {role!r}, which is not a role. Roles are "
                f"{', '.join(ROLES)}"
                + (f". Did you mean {hint!r}? Roles are case-sensitive." if hint else ".")
            )

    # Contrast labels have to exist. This is the check whose absence cost a
    # whole run: a one-letter typo used to pass QC, quietly analyse two
    # replicates instead of three, and then fail inside MAGeCK.
    #
    # It runs BEFORE roles are inferred, and the ordering is the whole point. A
    # typo removes a sample from the contrast, which also leaves that sample
    # with no inferable role, so both checks fire on `--treatment D21_a` for a
    # screen containing D21_A. Inferring first meant the missing-role check
    # spoke first and named D21_A, the sample that is fine, while the typo
    # D21_a and the one-edit hint for it were never mentioned. Only this check
    # knows which label the caller actually mistyped, so it goes first.
    for flag, group in (("--treatment", treatment), ("--control", control)):
        for label in group:
            if label not in known:
                hint = _near(label, labels)
                raise DesignError(
                    f"{flag} names sample {label!r}, which is not in this screen."
                    + (f" Did you mean {hint!r}?" if hint
                       else f" Samples are {sorted(known)}.")
                )
        dup = sorted({l for l in group if group.count(l) > 1})
        if dup:
            raise DesignError(f"{flag} lists {dup} more than once.")

    if not treatment:
        raise DesignError(
            "no --treatment sample. A contrast needs a numerator; MAGeCK is given "
            "'-t ' with nothing after it and exits 255 several minutes later."
        )
    if not control:
        raise DesignError(
            "no --control sample. A contrast needs a denominator: the arm the "
            "treatment arms are compared against."
        )

    both = sorted(set(treatment) & set(control))
    if both:
        raise DesignError(
            f"sample(s) {both} are on both sides of the contrast, which compares them "
            "with themselves."
        )

    merged, notes = infer_roles(labels, treatment, control, roles)

    # A sample in neither side of the contrast whose name says nothing either.
    # Reached only once the contrast itself is known to be well formed, so this
    # really is a sample the caller has not accounted for rather than the
    # shadow of a typo somewhere else.
    missing_role = [l for l in labels if l not in merged]
    if missing_role:
        raise DesignError(
            f"sample(s) {missing_role} are in neither --treatment nor --control and "
            "their names do not say what they are, so the engine will not guess. Pass "
            f"--role {missing_role[0]}=<{'|'.join(ROLES)}>. Use 'plasmid' for the "
            "plasmid pool and 'reference' for a T0 or day-0 sample: both are library "
            "references that QC measures dropout against."
        )

    # --- inverted contrast -------------------------------------------------
    # The roles already say which arms are the endpoint and which is the
    # library reference, so an upside-down contrast is free to detect. Left
    # alone it produces a fully confident, fully inverted gene list: core
    # essential genes called ENRICHED, because they are present in the
    # reference and gone by the endpoint.
    ref_in_numerator = [s for s in treatment
                        if merged.get(s) in REFERENCE_ROLES or looks_like_baseline(s)]
    if ref_in_numerator:
        endpoints = [s for s in control
                     if merged.get(s) not in REFERENCE_ROLES and not looks_like_baseline(s)]
        fix = (f" Did you mean --treatment {' --treatment '.join(endpoints)} "
               f"--control {' --control '.join(ref_in_numerator)}?" if endpoints else "")
        raise DesignError(
            f"the contrast is inverted: {ref_in_numerator} sit on the --treatment side "
            "but are library references, not endpoints. Run this way round and every "
            "core essential gene is called enriched, because it is present in the "
            "reference and gone by the endpoint." + fix
        )

    # A baseline sample on the denominator side is normal and is the most
    # common dropout design. A baseline carrying an endpoint role is not, and
    # it used to make QC measure T0 against plasmid and fail a good screen.
    for label in labels:
        if looks_like_baseline(label) and merged[label] not in REFERENCE_ROLES:
            notes.append(
                f"{label} is named like the screen's library reference but was given "
                f"role {merged[label]!r}. QC keeps it out of the dropout endpoint; if "
                f"it really is an endpoint arm, rename it."
            )

    for label in treatment:
        if merged[label] != "treatment":
            notes.append(f"{label} is on the --treatment side with role "
                         f"{merged[label]!r}.")
    for label in control:
        if merged[label] not in ("control",) + REFERENCE_ROLES:
            notes.append(f"{label} is on the --control side with role "
                         f"{merged[label]!r}.")

    unused = [l for l in labels if l not in treatment and l not in control]
    for label in unused:
        if merged[label] not in REFERENCE_ROLES:
            notes.append(
                f"{label} is in neither side of the contrast; it is carried through "
                f"counting and QC as a {merged[label]!r} sample but scores nothing."
            )

    return Design(roles=merged, treatment=list(treatment), control=list(control),
                  notes=notes)
