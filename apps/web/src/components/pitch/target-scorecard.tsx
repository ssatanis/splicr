"use client";

import { Info, TrendingUp } from "lucide-react";
import { PolarAngleAxis, RadialBar, RadialBarChart } from "recharts";

import { translationalScore, type DiligenceInputs } from "./model";

const inputs: DiligenceInputs = {
  structuralVulnerability: 84,
  contextualEscapeRisk: 24,
  toxicityRisk: 31,
};

const dimensions = [
  {
    label: "Structural vulnerability",
    value: inputs.structuralVulnerability,
    display: inputs.structuralVulnerability,
    tone: "#0b7285",
    detail: "3 of 4 depleting guides converge on the ATPase domain",
    direction: "higher supports tractability",
  },
  {
    label: "Contextual escape risk",
    value: inputs.contextualEscapeRisk,
    display: inputs.contextualEscapeRisk,
    tone: "#c2560a",
    detail: "ARID1B rescue signal present; paired perturbation pending",
    direction: "lower is preferable",
  },
  {
    label: "Toxicity / off-target risk",
    value: inputs.toxicityRisk,
    display: inputs.toxicityRisk,
    tone: "#174f62",
    detail: "GTEx healthy-tissue expression concentrated below risk ceiling",
    direction: "lower is preferable",
  },
] as const;

function Dial({ value, tone }: { value: number; tone: string }) {
  return (
    <div className="relative h-[86px] w-[86px] shrink-0" aria-hidden="true">
      <RadialBarChart
        width={86}
        height={86}
        cx={43}
        cy={43}
        innerRadius={31}
        outerRadius={40}
        barSize={7}
        data={[{ value, fill: tone }]}
        startAngle={90}
        endAngle={-270}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
        <RadialBar dataKey="value" background={{ fill: "#e6ebef" }} cornerRadius={8} />
      </RadialBarChart>
      <span className="num absolute inset-0 grid place-items-center text-[20px] font-medium text-ink">
        {value}
      </span>
    </div>
  );
}

export function TargetScorecard() {
  const score = translationalScore(inputs);

  return (
    <section id="diligence" aria-labelledby="diligence-title" className="scroll-mt-4">
      <div className="overflow-hidden rounded-xl border border-line bg-white shadow-card">
        <div className="grid xl:grid-cols-[245px_1fr]">
          <div className="bg-teal-950 p-5 text-white">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-cyan-400">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              Target diligence
            </div>
            <div className="mt-5 flex items-end gap-3">
              <span className="num text-6xl font-medium leading-none text-white">{score}</span>
              <span className="mb-1.5 text-sm text-white/55">/ 100</span>
            </div>
            <h2 id="diligence-title" className="mt-3 font-serif text-[21px] leading-tight text-white">
              Translational Probability Score
            </h2>
            <p className="mt-3 text-[11px] leading-relaxed text-white/60">
              Transparent diligence index: 40% structure, 35% escape resilience, 25% safety margin.
              It is not a calibrated clinical probability.
            </p>
          </div>

          <div className="grid md:grid-cols-3">
            {dimensions.map((dimension, index) => (
              <article
                key={dimension.label}
                className={`flex min-w-0 items-center gap-3 p-4 ${index > 0 ? "border-t border-line md:border-l md:border-t-0" : ""}`}
              >
                <Dial value={dimension.display} tone={dimension.tone} />
                <div className="min-w-0">
                  <h3 className="text-[12px] font-medium leading-tight text-ink">{dimension.label}</h3>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted">{dimension.direction}</p>
                  <p className="mt-2 text-[11px] leading-snug text-body">{dimension.detail}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-line bg-canvas px-4 py-2 text-[10.5px] text-muted">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Illustrative ARID1A diligence record, A375, evidence snapshot 30 Sep 2026, every input remains inspectable below</span>
        </div>
      </div>
    </section>
  );
}
