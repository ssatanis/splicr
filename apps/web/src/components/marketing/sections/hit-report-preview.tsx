import { LinkButton } from "@/components/ui/bits";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";

/**
 * The shape of a Hit Report, not one we ran. The genes and the direction of
 * each effect come from published A375 ferroptosis work, so the example is at
 * least biologically true; the fold changes, FDRs and confidences are invented
 * to show the columns. Anything added here has to stay inventable, and the
 * caption under the card has to keep saying so.
 */
const rows = [
  {
    gene: "ACSL4",
    chance: 0.91,
    lfc: -2.41,
    fdr: "3e-8",
    guides: "4/4",
    verdict: "Real and new",
    why: "All four guides agree. Hit in three similar screens from other labs.",
  },
  {
    gene: "SLC7A11",
    chance: 0.88,
    lfc: -2.06,
    fdr: "9e-8",
    guides: "4/4",
    verdict: "Real and known",
    why: "Established cystine importer. Positive control for this phenotype.",
  },
  {
    gene: "MCM7",
    chance: 0.09,
    lfc: -1.88,
    fdr: "2e-6",
    guides: "3/4",
    verdict: "Artifact",
    why: "Sits in an amplified region. Neighbouring genes drop out with it.",
  },
  {
    gene: "TXNRD1",
    chance: 0.21,
    lfc: -1.52,
    fdr: "4e-4",
    guides: "1/4",
    verdict: "Artifact",
    why: "One guide carries about 90% of the gene-level signal.",
  },
  {
    gene: "RPL3",
    chance: 0.74,
    lfc: -3.10,
    fdr: "1e-11",
    guides: "4/4",
    verdict: "Real but generic",
    why: "Core essential. Depletes in 96% of unrelated screens.",
  },
] as const;

const verdictTone: Record<string, string> = {
  "Real and new": "bg-orange-500",
  "Real and known": "bg-cyan-500",
  "Real but generic": "bg-teal-500",
  Artifact: "bg-teal-800",
};

export function HitReportPreview() {
  return (
    <section className="py-16 md:py-24">
      <div className="container-x">
        <div className="grid lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-16 items-start">
          <Reveal>
            <div className="eyebrow">Hit Report</div>
            <h2 className="mt-4 display text-ink text-3xl md:text-4xl lg:text-[2.8rem] leading-[1.15] text-balance">
              Every hit arrives with a number, a reason, and a next step.
            </h2>
            <p className="mt-6 text-body leading-relaxed max-w-md">
              The statistics are the field&apos;s own. What SplicR adds is the chance the hit
              survives a re-test, learned from screens where somebody checked.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="rounded-[1.5rem] border border-line bg-white shadow-card overflow-hidden">
              <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-line">
                <div className="min-w-0">
                  <div className="text-ink font-medium truncate">A375 ferroptosis sensitizers</div>
                  <div className="text-xs text-muted">Sample report · Brunello · RSL3 against DMSO · 212 candidate hits</div>
                </div>
                <LinkButton href="/dashboard/screens/scr_demo" tone="orange" size="sm" icon="none">
                  Open
                </LinkButton>
              </div>

              <div className="overflow-x-auto thin-scroll">
                <table className="table-base min-w-[640px]">
                  <thead>
                    <tr>
                      <th>Gene</th>
                      <th>Chance real</th>
                      <th>LFC</th>
                      <th>FDR</th>
                      <th>Guides</th>
                      <th>Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.gene}>
                        <td className="font-medium whitespace-nowrap">{r.gene}</td>
                        <td>
                          <span className="inline-flex items-center gap-2">
                            <span className="progress-track w-14">
                              <span
                                className={cn("progress-fill block", verdictTone[r.verdict])}
                                style={{ width: `${r.chance * 100}%` }}
                              />
                            </span>
                            <span className="tabular-nums text-sm font-medium">
                              {Math.round(r.chance * 100)}%
                            </span>
                          </span>
                        </td>
                        <td className="tabular-nums">{r.lfc.toFixed(2)}</td>
                        <td className="tabular-nums text-muted text-xs">{r.fdr}</td>
                        <td className="tabular-nums text-sm">{r.guides}</td>
                        <td className="text-sm whitespace-nowrap">{r.verdict}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="px-5 py-4 border-t border-line space-y-2 bg-mist-soft/50">
                {rows.slice(0, 3).map((r) => (
                  <li key={r.gene} className="text-xs text-body flex gap-2">
                    <span className="font-medium text-ink shrink-0">{r.gene}</span>
                    <span>{r.why}</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* The old caption said the effects "reflect published screens",
                which invited a reader to take the fold changes as measured.
                They are not measured. The genes and the directions come from
                published A375 ferroptosis work; every number beside them is
                made up to show the shape of the report. Say that first. */}
            <p className="mt-3 text-xs text-muted">
              A sample report, not a measurement. The genes and the direction of each effect come
              from published ferroptosis screens in A375. The numbers beside them are illustrative
              until your own screen is scored.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
