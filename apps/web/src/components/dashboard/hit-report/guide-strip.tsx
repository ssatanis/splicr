/**
 * The recorded per-guide effects of one gene, as dots on a line.
 *
 * A gene-level statistic can hide that one guide carries all the signal, and the
 * strip shows that at a glance: four dots on one side of zero is a gene, one dot
 * far out and three at zero is a guide. The scale is fixed across the whole page,
 * not fitted to each row, because a row scaled to itself makes every gene look
 * as strong as the next.
 *
 * Nothing is computed here. The dots are the recorded values, and a gene with no
 * recorded guide effects gets no strip rather than an empty one.
 */
import { guidesAgreeing } from "@/lib/report/format";

export const STRIP_DOMAIN = 4;

export function GuideStrip({
  values,
  geneLfc,
  width = 84,
}: {
  values: readonly number[] | null;
  geneLfc: number | null;
  width?: number;
}) {
  const finite = (values ?? []).filter((value) => Number.isFinite(value));
  if (finite.length === 0) return <span className="text-muted">Not recorded</span>;
  const agreement = guidesAgreeing(finite, geneLfc);
  const mid = width / 2;
  const scale = (mid - 4) / STRIP_DOMAIN;
  const label = agreement
    ? `${agreement.agree} of ${agreement.total} recorded guide effects point the same way as the gene-level effect.`
    : `${finite.length} recorded guide effects.`;
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={width} height={16} viewBox={`0 0 ${width} 16`} role="img" aria-label={label} className="shrink-0">
        <title>{label}</title>
        <line x1={0} x2={width} y1={8} y2={8} stroke="currentColor" className="text-line-strong" strokeWidth={1} />
        <line x1={mid} x2={mid} y1={2} y2={14} stroke="currentColor" className="text-muted" strokeWidth={1} />
        {finite.map((value, index) => {
          const clipped = Math.max(-STRIP_DOMAIN, Math.min(STRIP_DOMAIN, value));
          const x = mid + clipped * scale;
          return (
            <circle
              key={index}
              cx={x}
              cy={8}
              r={2.6}
              className={value < 0 ? "fill-cyan-600" : "fill-orange-500"}
              fillOpacity={0.85}
              stroke={clipped !== value ? "currentColor" : "none"}
            />
          );
        })}
      </svg>
      {agreement && (
        <span className="num inline-block w-6 text-right text-[11px] text-muted">
          {agreement.agree}/{agreement.total}
        </span>
      )}
    </span>
  );
}
