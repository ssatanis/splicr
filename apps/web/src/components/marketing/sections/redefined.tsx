"use client";

import { useState } from "react";

import { MoleculeArt } from "@/components/three";
import { DragControl } from "@/components/ui/drag-control";
import { Reveal } from "@/components/ui/reveal";

const stats = [
  { value: "2,217", label: "Public screens" },
  { value: "1,349", label: "Screens learned from" },
  { value: "334", label: "Held-out test screens" },
];

export function RedefinedSection() {
  const [spin, setSpin] = useState(0);

  return (
    <section className="px-3 md:px-5 pb-6">
      <div className="relative rounded-[2rem] bg-teal-800 text-white overflow-hidden min-h-[620px] md:min-h-[760px]">
        <MoleculeArt className="absolute inset-0 z-0" spin={spin} />
        {/* Keeps the headline legible wherever the molecule happens to sit. */}
        <div
          aria-hidden
          className="absolute inset-0 z-[1] bg-[linear-gradient(to_bottom,rgba(17,61,76,0.55)_0%,rgba(17,61,76,0.1)_38%,rgba(17,61,76,0.72)_78%,rgba(17,61,76,0.92)_100%)]"
        />

        <div className="relative z-10 min-h-[620px] md:min-h-[760px] container-x flex flex-col justify-between py-12 md:py-16">
          <Reveal>
            <h2 className="display text-white text-[clamp(2.75rem,8vw,7rem)] leading-[0.95] drop-shadow-[0_2px_24px_rgba(11,47,59,0.65)]">
              Screens
            </h2>
          </Reveal>

          <div className="flex justify-center py-8">
            <DragControl onChange={setSpin} label="Drag to rotate the model" />
          </div>

          <div>
            <Reveal>
              <h2 className="display text-white text-[clamp(2.75rem,8vw,7rem)] leading-[0.95] text-right drop-shadow-[0_2px_24px_rgba(11,47,59,0.75)]">
                Redefined.
              </h2>
            </Reveal>

            <div className="mt-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
              <p className="max-w-sm text-white/90 leading-relaxed">
                Precision, honesty about uncertainty, and a record of what actually held up.
              </p>
              <div className="flex flex-wrap gap-y-4 divide-x divide-white/25">
                {stats.map((s) => (
                  <div key={s.label} className="px-6 first:pl-0 last:pr-0">
                    <div className="text-2xl md:text-3xl font-medium tabular-nums">{s.value}</div>
                    <div className="mt-1 text-white/90 text-xs md:text-sm">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
