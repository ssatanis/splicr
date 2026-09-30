/**
 * What the guides did.
 *
 * A gene's fold change is an average over its guides, and the average hides the
 * only thing a screening scientist actually wants to know: did the guides agree?
 * Three guides all depleting is a hit. One guide carrying the signal while two sit
 * flat is an artifact. Both can report the same gene-level number, and a count of
 * "2 of 3 good guides" does not separate them either, because it says how many
 * passed a filter and not how far apart they were.
 *
 * So this draws each guide's own log2 fold change on a shared scale, signed, with
 * zero in the middle. The picture is the judgement.
 *
 * Real examples from the one screen in the database:
 *
 *   PARG   [+4.34, +3.41, +1.55]   three guides, same direction, tight
 *   COG4   [+5.32, +5.92, -0.79]   two strong, one running the other way
 *
 * The data is `public.hits.guide_lfcs`, a real[] the schema calls "per-guide, for
 * the concordance view". It is populated on 20,665 of 20,916 rows. Where it is
 * null the chart says so rather than drawing a flat bar, because a bar at zero
 * and no measurement look identical and mean opposite things.
 */

/** Depleted and enriched are drawn as direction, never as red against green. */
const DEPLETED = "#174f62"; // teal-800
const ENRICHED = "#c2560a"; // orange-500
const MUTED = "#9db3bd";

export function GuideChart({
  values,
  goodGuides,
  className,
}: {
  /** Per-guide log2 fold change. Null when the caller did not record it. */
  values: number[] | null;
  /** How many the caller kept, when it said. */
  goodGuides?: number | null;
  className?: string;
}) {
  if (values === null || values.length === 0) {
    return (
      <p className={["text-[12px] text-muted", className].filter(Boolean).join(" ")}>
        Per-guide fold change not recorded for this hit.
      </p>
    );
  }

  // A symmetric scale, so a bar's length is comparable across genes and the two
  // directions cannot be made to look different sizes by the axis.
  const extent = Math.max(1, ...values.map((v) => Math.abs(v)));
  const sorted = [...values].sort((a, b) => b - a);

  // Guides agree when they all point the same way. That is the claim the
  // sentence under the chart makes, and it is deliberately stricter than the
  // caller's own "good guide" count, which can keep a guide that disagrees.
  const positive = values.filter((v) => v > 0).length;
  const negative = values.filter((v) => v < 0).length;
  const agreeing = Math.max(positive, negative);
  const unanimous = agreeing === values.length;

  return (
    <div className={className}>
      <ul className="space-y-1.5">
        {sorted.map((value, i) => {
          const share = Math.abs(value) / extent;
          const enriched = value > 0;
          return (
            <li key={`${value}-${i}`} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted">
                g{i + 1}
              </span>

              {/* Zero sits in the middle: a bar's side is its direction. */}
              <span className="relative h-3 flex-1 rounded-[2px] bg-cream">
                <span className="absolute inset-y-0 left-1/2 w-px bg-line" aria-hidden="true" />
                <span
                  className="absolute inset-y-0 rounded-[2px]"
                  style={{
                    background: enriched ? ENRICHED : DEPLETED,
                    left: enriched ? "50%" : `${50 - share * 50}%`,
                    width: `${share * 50}%`,
                  }}
                />
              </span>

              <span
                className="w-14 shrink-0 text-right text-[11px] tabular-nums"
                style={{ color: enriched ? ENRICHED : DEPLETED }}
              >
                {value > 0 ? "+" : ""}
                {value.toFixed(2)}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-[11.5px] leading-snug text-body">
        {unanimous ? (
          <>
            <span className="font-medium text-ink">
              All {values.length} guides agree
            </span>
            {values.length <= 3 ? (
              <span className="text-muted">
                {" "}
                — which is the strongest statement {values.length} guides can make.
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className="font-medium text-ink">
              {agreeing} of {values.length} guides agree
            </span>
            <span className="text-muted">
              {" "}
              — {values.length - agreeing}{" "}
              {values.length - agreeing === 1 ? "runs" : "run"} the other way.
            </span>
          </>
        )}
        {typeof goodGuides === "number" && goodGuides !== agreeing ? (
          <span className="text-muted"> The caller kept {goodGuides}.</span>
        ) : null}
      </p>
    </div>
  );
}

/** A one-line version for a table row: direction and agreement, no numbers. */
export function GuideSpark({
  values,
  className,
}: {
  values: number[] | null;
  className?: string;
}) {
  if (values === null || values.length === 0) {
    return <span className={["text-[11px] text-muted", className].filter(Boolean).join(" ")}>—</span>;
  }
  const extent = Math.max(1, ...values.map((v) => Math.abs(v)));
  return (
    <span
      className={["inline-flex items-center gap-[3px]", className].filter(Boolean).join(" ")}
      aria-label={`${values.length} guides`}
    >
      {[...values]
        .sort((a, b) => b - a)
        .map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="w-[3px] rounded-[1px]"
            style={{
              height: `${Math.max(3, (Math.abs(v) / extent) * 14)}px`,
              background: v > 0 ? ENRICHED : v < 0 ? DEPLETED : MUTED,
            }}
          />
        ))}
    </span>
  );
}
