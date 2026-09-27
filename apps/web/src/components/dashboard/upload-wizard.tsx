"use client";

import { ArrowLeft, ArrowRight, Check, FileUp, Loader2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { libraries } from "@/lib/mock/data";
import { cn, formatNumber } from "@/lib/utils";

import { Card } from "./ui";

const steps = ["Files", "Library", "Design", "Settings", "Launch"];

type FileRow = { name: string; size: number; kind: "fastq" | "counts" | "other" };

const demoFiles: FileRow[] = [
  { name: "plasmid_S1_R1.fastq.gz", size: 2.9e9, kind: "fastq" },
  { name: "T0_rep1_S2_R1.fastq.gz", size: 2.7e9, kind: "fastq" },
  { name: "T0_rep2_S3_R1.fastq.gz", size: 2.6e9, kind: "fastq" },
  { name: "DMSO_rep1_S4_R1.fastq.gz", size: 2.9e9, kind: "fastq" },
  { name: "DMSO_rep2_S5_R1.fastq.gz", size: 2.8e9, kind: "fastq" },
  { name: "RSL3_rep1_S6_R1.fastq.gz", size: 2.9e9, kind: "fastq" },
  { name: "RSL3_rep2_S7_R1.fastq.gz", size: 1.7e9, kind: "fastq" },
];

export function UploadWizard() {
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [library, setLibrary] = useState("Brunello");
  const [design, setDesign] = useState<Record<string, string>>({});
  const [launched, setLaunched] = useState(false);

  const lib = libraries.find((l) => l.name === library)!;
  const totalBytes = useMemo(() => files.reduce((a, f) => a + f.size, 0), [files]);

  return (
    <div className="grid lg:grid-cols-[220px_1fr] gap-6">
      <ol className="flex lg:flex-col gap-2">
        {steps.map((s, i) => (
          <li
            key={s}
            className={cn(
              "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm",
              i === step ? "bg-teal-800 text-white" : i < step ? "bg-white text-ink border border-line" : "text-muted",
            )}
          >
            <span className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs", i < step ? "bg-cyan-500 text-white" : i === step ? "bg-white/15" : "bg-mist-soft")}>
              {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <div className="space-y-4">
        {step === 0 && (
          <Card title="Add files" subtitle="FASTQ(.gz), a count table, MAGeCK output, or an SRA accession">
            <button
              type="button"
              onClick={() => setFiles(demoFiles)}
              className="w-full rounded-3xl border-2 border-dashed border-line-strong hover:border-cyan-500 hover:bg-cyan-50/40 transition-colors p-10 text-center"
            >
              <FileUp className="w-8 h-8 mx-auto text-cyan-500" />
              <div className="mt-3 text-ink font-medium">Drop files here or click to browse</div>
              <div className="text-sm text-muted mt-1">Up to 500 GB per file. Uploads resume if the tab closes.</div>
              <div className="mt-4 inline-flex chip text-xs">Load the demo file set</div>
            </button>
            {files.length > 0 && (
              <div className="mt-5">
                <ul className="divide-y divide-line">
                  {files.map((f) => (
                    <li key={f.name} className="py-2.5 flex items-center justify-between text-sm">
                      <span className="text-ink font-mono text-xs">{f.name}</span>
                      <span className="text-muted">{(f.size / 1e9).toFixed(1)} GB</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 text-sm text-muted">
                  {files.length} files · {(totalBytes / 1e9).toFixed(1)} GB · will upload in 6 MB resumable chunks
                </div>
              </div>
            )}
            <div className="mt-6 flex items-center gap-3">
              <input className="underline-input max-w-xs" placeholder="…or paste an SRA/GEO accession (SRP, GSE)" />
            </div>
          </Card>
        )}

        {step === 1 && (
          <Card title="Library detected" subtitle="From the first 200,000 reads of each file">
            <div className="rounded-2xl bg-cyan-50 border border-cyan-100 p-5 flex items-start gap-4">
              <span className="w-10 h-10 rounded-full bg-cyan-500 text-white flex items-center justify-center shrink-0">
                <Check className="w-5 h-5" />
              </span>
              <div>
                <div className="text-ink font-medium">
                  {lib.name} · {formatNumber(lib.guides)} guides · {formatNumber(lib.genes)} genes
                </div>
                <div className="text-sm text-body mt-1">
                  99.6% of sampled reads match. Guide starts at position 24 on the forward strand after the U6 tail; scaffold anchor found at
                  position 44.
                </div>
              </div>
            </div>
            <div className="mt-6">
              <div className="label-sm mb-2">Override if the call is wrong</div>
              <div className="grid sm:grid-cols-2 gap-2">
                {libraries.map((l) => (
                  <button
                    key={l.name}
                    onClick={() => setLibrary(l.name)}
                    className={cn(
                      "text-left rounded-2xl border p-4 text-sm transition-colors",
                      library === l.name ? "border-teal-800 bg-teal-800 text-white" : "border-line hover:border-line-strong",
                    )}
                  >
                    <div className="font-medium">{l.name}</div>
                    <div className={cn("text-xs mt-0.5", library === l.name ? "text-white/70" : "text-muted")}>
                      {formatNumber(l.guides)} guides · {l.perGene}/gene · {l.cas} · {l.organism}
                    </div>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted">Custom library? Upload a CSV with id, sequence, gene columns on the next step.</p>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card title="Design" subtitle="Assign each file to a condition, replicate and timepoint">
            <div className="overflow-x-auto thin-scroll">
              <table className="table-base min-w-[720px]">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Condition</th>
                    <th>Replicate</th>
                    <th>Timepoint</th>
                    <th>Role</th>
                  </tr>
                </thead>
                <tbody>
                  {(files.length ? files : demoFiles).map((f) => {
                    const guess = f.name.split("_")[0];
                    const rep = /rep(\d)/.exec(f.name)?.[1] ?? "1";
                    return (
                      <tr key={f.name}>
                        <td className="font-mono text-xs">{f.name}</td>
                        <td>
                          <input
                            className="underline-input py-1 text-sm"
                            defaultValue={guess}
                            onChange={(e) => setDesign((d) => ({ ...d, [f.name]: e.target.value }))}
                          />
                        </td>
                        <td>
                          <input className="underline-input py-1 text-sm w-12" defaultValue={rep} />
                        </td>
                        <td>
                          <input className="underline-input py-1 text-sm w-16" defaultValue={guess === "plasmid" || guess === "T0" ? "d0" : "d14"} />
                        </td>
                        <td>
                          <select className="text-sm bg-transparent border-b border-line-strong py-1" defaultValue={guess === "plasmid" ? "plasmid" : guess === "T0" ? "control" : guess === "DMSO" ? "control" : "treatment"}>
                            <option value="plasmid">Plasmid</option>
                            <option value="control">Control</option>
                            <option value="treatment">Treatment</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted">
              Comparisons to run: RSL3 vs DMSO (drug effect), DMSO vs T0 (fitness). {Object.keys(design).length > 0 ? "Edited." : "Guessed from file names; edit anything."}
            </p>
          </Card>
        )}

        {step === 3 && (
          <Card title="Settings" subtitle="Sensible defaults; change only if you know why">
            <div className="grid md:grid-cols-2 gap-6 text-sm">
              {[
                ["Normalization", ["Median (MAGeCK default)", "Total count", "Control guides"]],
                ["Hit callers", ["MAGeCK RRA + MLE + BAGEL2", "MAGeCK RRA only", "DrugZ (chemogenetic)"]],
                ["Copy-number correction", ["CRISPRcleanR (auto when coordinates known)", "Off"]],
                ["Mismatch tolerance", ["Exact, then 1 mismatch", "Exact only"]],
                ["Reference gene sets", ["Hart CEGv2 / NEGv1", "DepMap common essentials"]],
                ["Visibility", ["Private to my organization", "Public with citation (free tier)"]],
              ].map(([label, opts]) => (
                <div key={label as string}>
                  <div className="label-sm mb-2">{label}</div>
                  <select className="w-full rounded-xl border border-line px-3 py-2 bg-white text-ink">
                    {(opts as string[]).map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </Card>
        )}

        {step === 4 && (
          <Card title={launched ? "Run launched" : "Review and launch"}>
            {!launched ? (
              <div className="space-y-4">
                <dl className="grid sm:grid-cols-2 gap-3 text-sm">
                  {[
                    ["Files", `${(files.length ? files : demoFiles).length} FASTQ · ${((files.length ? totalBytes : demoFiles.reduce((a, f) => a + f.size, 0)) / 1e9).toFixed(1)} GB`],
                    ["Library", `${lib.name} (${formatNumber(lib.guides)} guides)`],
                    ["Design", "3 conditions · 2 replicates · plasmid + T0"],
                    ["Callers", "MAGeCK RRA, MLE, BAGEL2, CRISPRcleanR"],
                    ["Estimated time", "35–50 minutes"],
                    ["Estimated cost", "$1.40 compute"],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-xl bg-mist-soft p-3">
                      <dt className="text-xs text-muted">{k}</dt>
                      <dd className="text-ink font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                <button onClick={() => setLaunched(true)} className="btn btn-orange">
                  Launch run <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-4">
                <div className="inline-flex items-center gap-2 text-ink">
                  <Loader2 className="w-4 h-4 animate-spin text-orange-500" /> Queued as job_01J9… · you will get an email when it finishes
                </div>
                <p className="text-sm text-muted">The backend is not connected yet, so this run is illustrative.</p>
                <Link href="/dashboard/screens/scr_003" className="btn btn-teal btn-sm">
                  Watch the running screen
                </Link>
              </div>
            )}
          </Card>
        )}

        <div className="flex items-center justify-between">
          <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="btn btn-ghost btn-sm disabled:opacity-40">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          {step < steps.length - 1 && (
            <button onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))} className="btn btn-teal btn-sm">
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
