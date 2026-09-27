"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { atlasSimilar, demoHits } from "@/lib/mock/data";
import { formatNumber } from "@/lib/utils";

import { Card, Chance, Kpi } from "./ui";

const filters = {
  organism: ["Any", "Human", "Mouse"],
  modality: ["Any", "Knockout", "CRISPRi", "CRISPRa", "Base editing"],
  library: ["Any", "Brunello", "GeCKOv2", "TKOv3", "Avana", "Dolcetto", "Calabrese", "Brie"],
  source: ["Any", "BioGRID ORCS", "DepMap", "Project Score", "GEO/SRA re-run"],
};

export function AtlasExplorer() {
  const [gene, setGene] = useState("");
  const [sel, setSel] = useState<Record<string, string>>({ organism: "Any", modality: "Any", library: "Any", source: "Any" });
  const hit = useMemo(() => demoHits.find((h) => h.gene.toLowerCase() === gene.trim().toLowerCase()), [gene]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Screens" value={formatNumber(2217)} hint="BioGRID ORCS + DepMap + re-runs" />
        <Kpi label="Re-run from raw reads" value={formatNumber(96)} hint="Atlas v0 target: 50–100" tone="cyan" />
        <Kpi label="Hits with outcomes" value={formatNumber(1_840)} hint="Answer key, pilot" tone="orange" />
        <Kpi label="Last refresh" value="Sep 2026" hint="Monthly" />
      </div>

      <div className="grid lg:grid-cols-[1fr_1.3fr] gap-4">
        <Card title="Gene history" subtitle="How often a gene hit, in which contexts, and whether it validated">
          <div className="flex items-center gap-3 rounded-full border border-line px-4 py-2">
            <Search className="w-4 h-4 text-muted" />
            <input value={gene} onChange={(e) => setGene(e.target.value)} placeholder="Try ACSL4, SLC7A11, MCM7" className="w-full outline-none text-sm text-ink" />
          </div>
          {hit ? (
            <div className="mt-5">
              <div className="flex items-center justify-between">
                <div className="text-2xl text-ink font-medium">{hit.gene}</div>
                <Chance value={hit.chance} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-mist-soft p-3">
                  <dt className="text-xs text-muted">Hit in</dt>
                  <dd className="text-ink font-medium">
                    {hit.atlasHits} of {formatNumber(hit.atlasScreens)} screens
                  </dd>
                </div>
                <div className="rounded-xl bg-mist-soft p-3">
                  <dt className="text-xs text-muted">Frequent hitter</dt>
                  <dd className="text-ink font-medium">{hit.atlasHits > 200 ? "Yes" : "No"}</dd>
                </div>
                <div className="rounded-xl bg-mist-soft p-3">
                  <dt className="text-xs text-muted">Validated elsewhere</dt>
                  <dd className="text-ink font-medium">{hit.chance > 0.6 ? "3 of 4 re-tests" : "0 of 2 re-tests"}</dd>
                </div>
                <div className="rounded-xl bg-mist-soft p-3">
                  <dt className="text-xs text-muted">Contexts</dt>
                  <dd className="text-ink font-medium">Ferroptosis, melanoma</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">Type a gene symbol from the demo screen to see its history.</p>
          )}
        </Card>

        <Card title="Browse screens">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
            {Object.entries(filters).map(([k, opts]) => (
              <select key={k} value={sel[k]} onChange={(e) => setSel((s) => ({ ...s, [k]: e.target.value }))} className="rounded-xl border border-line px-3 py-2 text-sm bg-white text-ink">
                {opts.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ))}
          </div>
          <ul className="divide-y divide-line">
            {atlasSimilar
              .filter((a) => sel.library === "Any" || a.library.startsWith(sel.library))
              .map((a) => (
                <li key={a.id} className="py-3 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-ink font-medium">{a.title}</div>
                    <div className="text-xs text-muted mt-0.5">
                      {a.id} · {a.source} · {a.cellLine} · {a.library} · {a.year}
                    </div>
                  </div>
                  <span className="chip text-xs bg-mist-soft">{a.phenotype}</span>
                </li>
              ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Showing 5 of 2,217. Full browsing arrives with the Atlas API.</p>
        </Card>
      </div>
    </div>
  );
}
