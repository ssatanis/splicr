"use client";

/**
 * The AlphaFold model of the protein, with the cut residue highlighted.
 *
 * WHAT THE PICTURE IS AND IS NOT
 *
 * It is a predicted structure of the wild-type protein, from the AlphaFold
 * Protein Structure Database, shown so a reader can see where along the fold a
 * guide cut. It is not a prediction of what the edit did. AlphaFold models the
 * sequence it was given; it does not model a knockout, a frameshift or a
 * truncation, and per-residue confidence (pLDDT) measures how sure the predictor
 * was about the wild-type fold, not how damaging an edit at that residue would be.
 * The caption says so, in the viewer, where a reader looking at a highlighted
 * residue will read it.
 *
 * EVERY STATE IS NAMED
 *
 * A protein can have no reviewed UniProt accession, an accession with no AlphaFold
 * entry, or an entry that fails to load. Those are three different facts and none
 * of them is "loading". The viewer reports whichever one applies and never leaves
 * a spinner running as a stand-in for an answer.
 *
 * The model is fetched and the residue is highlighted only after the reader asks
 * for it. A structure is several megabytes and a reader scanning a gene table has
 * not asked for one.
 */
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

// The viewer's own stylesheet, imported here rather than in the root layout so
// Next.js puts its 80 KB in this component's chunk. Only a reader who opens a
// structure downloads it.
import "pdbe-molstar/build/pdbe-molstar-light.css";

/** The AlphaFold DB model version this viewer requests. */
const ALPHAFOLD_VERSION = 4;
const MODEL_URL = (accession: string) =>
  `https://alphafold.ebi.ac.uk/files/AF-${accession}-F1-model_v${ALPHAFOLD_VERSION}.pdb`;
/**
 * The pdbe-molstar release this viewer was written against.
 *
 * It has to match the installed package, because the bundle is copied out of
 * node_modules into public/ under this exact name by
 * apps/web/scripts/copy-vendor.mjs. A web test asserts all three agree, so a
 * dependency bump cannot leave the page requesting a file that is not there.
 */
export const VIEWER_VERSION = "3.12.0";
/** Served from our own origin, so no page loads a third-party script. */
const MOLSTAR_SCRIPT = `/vendor/pdbe-molstar/pdbe-molstar-component-${VIEWER_VERSION}.js`;

interface MolstarElement extends HTMLElement {
  viewerInstance?: {
    visual: {
      highlight: (options: {
        data: { auth_asym_id: string; auth_seq_id: number }[];
        color?: string;
        focus?: boolean;
      }) => Promise<void>;
      clearHighlight: () => Promise<void>;
    };
    plugin?: { dispose: () => void };
  };
}

type State =
  | { kind: "idle" }
  | { kind: "no_accession" }
  | { kind: "checking" }
  | { kind: "no_model" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "failed"; reason: string };

export function StructureViewer({
  accession,
  residue,
  residueLabel,
}: {
  accession: string | null;
  /** The residue to centre, or null to clear the highlight. */
  residue: number | null;
  /** What the reader hovered, for the caption. */
  residueLabel: string | null;
}) {
  const hostRef = useRef<MolstarElement | null>(null);
  // The parent remounts this component per accession (see GeneDrawer), so the
  // initial state is the whole story: there is no prop change to synchronise.
  const [state, setState] = useState<State>(accession ? { kind: "idle" } : { kind: "no_accession" });
  const [scriptReady, setScriptReady] = useState(false);

  /**
   * Ask AlphaFold whether a model exists before mounting a viewer for it.
   *
   * Without this check a protein with no entry renders an empty canvas, which
   * reads as "the structure is featureless" rather than "there is no structure".
   */
  const load = useCallback(async () => {
    if (!accession) return;
    setState({ kind: "checking" });
    try {
      const response = await fetch(MODEL_URL(accession), { method: "HEAD" });
      if (response.status === 404) {
        setState({ kind: "no_model" });
        return;
      }
      if (!response.ok) {
        setState({ kind: "failed", reason: `AlphaFold answered ${response.status}` });
        return;
      }
      setState({ kind: "loading" });
    } catch {
      setState({ kind: "failed", reason: "AlphaFold could not be reached" });
    }
  }, [accession]);

  // The custom element reports readiness by assigning viewerInstance. Poll for it
  // with a deadline, so a viewer that never initialises becomes a stated failure
  // rather than a permanent "loading".
  useEffect(() => {
    if (state.kind !== "loading" || !scriptReady) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (hostRef.current?.viewerInstance) {
        window.clearInterval(timer);
        setState({ kind: "ready" });
      } else if (Date.now() - started > 20000) {
        window.clearInterval(timer);
        setState({ kind: "failed", reason: "the structure viewer did not initialise" });
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [state.kind, scriptReady]);

  useEffect(() => {
    const viewer = hostRef.current?.viewerInstance;
    if (!viewer || state.kind !== "ready") return;
    if (residue === null) {
      void viewer.visual.clearHighlight().catch(() => undefined);
      return;
    }
    // AlphaFold models are a single chain, labelled A.
    void viewer.visual
      .highlight({ data: [{ auth_asym_id: "A", auth_seq_id: residue }], focus: true })
      .catch(() => undefined);
  }, [residue, state.kind]);

  useEffect(() => () => hostRef.current?.viewerInstance?.plugin?.dispose(), []);

  const caption = (
    <p className="text-[11px] leading-snug text-muted">
      Predicted structure of the unedited protein, AlphaFold DB model v{ALPHAFOLD_VERSION}
      {accession ? <> for <span className="num">{accession}</span></> : null}. It shows where along
      the fold a guide cut. It is not a prediction of what the edit did to the protein, and
      per-residue confidence describes the wild-type model, not the effect of an edit.
    </p>
  );

  if (state.kind === "no_accession") {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-line bg-canvas px-3 py-4 text-[12.5px] text-body">
          No reviewed UniProt accession was resolved for this gene in this run, so there is
          no structure to show. The guide positions above do not depend on it.
        </div>
      </div>
    );
  }

  if (state.kind === "idle" || state.kind === "checking") {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-canvas px-3 py-4 text-[12.5px] text-body">
          <button
            type="button"
            onClick={load}
            disabled={state.kind === "checking"}
            className="rounded border border-line bg-surface px-3 py-1 text-[12px] text-ink hover:bg-canvas disabled:text-muted"
          >
            {state.kind === "checking" ? "Checking AlphaFold…" : "Load the AlphaFold model"}
          </button>
          <span className="text-muted">
            Several megabytes, fetched from AlphaFold DB only when you ask for it.
          </span>
        </div>
        {caption}
      </div>
    );
  }

  if (state.kind === "no_model") {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-line bg-canvas px-3 py-4 text-[12.5px] text-body">
          AlphaFold DB has no model v{ALPHAFOLD_VERSION} for{" "}
          <span className="num">{accession}</span>. Nothing about the measurements or the
          residue positions above depends on one.
        </div>
        {caption}
      </div>
    );
  }

  if (state.kind === "failed") {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-line bg-canvas px-3 py-4 text-[12.5px] text-body">
          <p className="text-ink">The structure could not be shown: {state.reason}.</p>
          <button
            type="button"
            onClick={load}
            className="mt-2 rounded border border-line bg-surface px-3 py-1 text-[12px] text-ink hover:bg-canvas"
          >
            Try again
          </button>
        </div>
        {caption}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative h-[300px] overflow-hidden rounded-md border border-line bg-canvas">
        <Script
          src={MOLSTAR_SCRIPT}
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
          onLoad={() => setScriptReady(true)}
          onError={() =>
            setState({ kind: "failed", reason: "the structure viewer script did not load" })
          }
        />
        <pdbe-molstar
          ref={(node: HTMLElement | null) => {
            hostRef.current = node as MolstarElement | null;
          }}
          custom-data-url={accession ? MODEL_URL(accession) : undefined}
          custom-data-format="pdb"
          alphafold-view="true"
          hide-controls="true"
          sequence-panel="false"
          pdbe-link="false"
        />
        {state.kind === "loading" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-canvas text-[12px] text-muted">
            Loading the AlphaFold model…
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 text-[11px]">
        <span className="text-ink">
          {residue === null
            ? "Hover or select a guide above to centre its residue."
            : <>Centred on residue <span className="num">{residue}</span>{residueLabel ? <> ({residueLabel})</> : null}</>}
        </span>
      </div>
      {caption}
    </div>
  );
}
