/**
 * One Atlas screen: the record, unaltered, and who else called what it called.
 *
 * The section a reader should trust most is "The authors' hit definition". It
 * is printed verbatim from the ORCS record, because "hit" means something
 * different in every study (a corrected p-value under 0.05, a log fold change
 * past a cut, a rank in the top 5%) and a count of hits means nothing until the
 * rule that produced it is next to it.
 */
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { DenseTable, FootLink, FootNote, PageHeader, Panel, PANEL_GRID, StatusChip, Th } from "@/components/dashboard/ui";
import { ROW_LINK } from "@/components/dashboard/console";
import {
  atlasGeneHref,
  atlasHref,
  atlasScreenHref,
  conditionLabel,
  modalityLabel,
  orcsScreenUrl,
  publicationLabel,
  publicationLink,
} from "@/lib/atlas/links";
import { describeScreen, hitDefinition, sameContext, screenHits, similarScreens } from "@/lib/atlas/query";
import { getAtlasGenes, getAtlasManifest, getAtlasScreenMap, getAtlasScreens } from "@/lib/atlas/store";
import { cn, formatNumber } from "@/lib/utils";

import { ROW_HIT } from "@/components/dashboard/ui";

export async function generateMetadata(props: PageProps<"/dashboard/atlas/screens/[id]">) {
  const { id } = await props.params;
  const screen = /^\d{1,7}$/.test(id) ? getAtlasScreenMap().get(Number(id)) : undefined;
  return { title: screen ? `${publicationLabel(screen)}, screen ${screen.id} | Atlas` : "Atlas screen" };
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-line">{children}</dl>;
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 py-1.5 text-[12px] leading-snug">
      <dt className="text-muted">{term}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

const NOT_RECORDED = <span className="text-muted">Not recorded</span>;
const or = (value: string | null | undefined): ReactNode => (value ? value : NOT_RECORDED);

export default async function AtlasScreenPage(props: PageProps<"/dashboard/atlas/screens/[id]">) {
  const [{ id }, search] = await Promise.all([props.params, props.searchParams]);
  if (!/^\d{1,7}$/.test(id)) notFound();
  const map = getAtlasScreenMap();
  const screen = map.get(Number(id));
  if (!screen) notFound();

  const manifest = getAtlasManifest();
  const genes = getAtlasGenes();
  const rawText = search.hq;
  const hitText = (Array.isArray(rawText) ? rawText[0] : rawText)?.slice(0, 40) ?? "";
  const rawPage = Number(Array.isArray(search.hpage) ? search.hpage[0] : search.hpage);
  const hits = screenHits(genes, screen.id, hitText, Number.isSafeInteger(rawPage) ? rawPage : 1);
  const similar = similarScreens(genes, map, screen.id, 6);
  const sameCell = sameContext(getAtlasScreens(), screen, 6);
  const source = publicationLink(screen);
  const rule = hitDefinition(screen);
  const condition = conditionLabel(screen);
  const listedDiffers = hits.total !== (screen.nHits ?? 0);

  const hitsHref = (page: number) => {
    const next = new URLSearchParams();
    if (hitText) next.set("hq", hitText);
    if (page > 1) next.set("hpage", String(page));
    const qs = next.toString();
    return `${atlasScreenHref(screen.id)}${qs ? `?${qs}` : ""}#genes`;
  };

  return (
    <div className="flex flex-col gap-3 pb-6">
      <PageHeader
        dense
        title={publicationLabel(screen)}
        body={`Screen ${screen.id}. ${describeScreen(screen)}`}
        actions={
          <>
            <Link
              href={atlasHref}
              className="inline-flex h-7 items-center gap-1 text-[12px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> All screens
            </Link>
            <a
              href={orcsScreenUrl(screen.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1 text-[12px] text-cyan-600 underline decoration-line-strong underline-offset-2 hover:decoration-cyan-600"
            >
              BioGRID ORCS <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">record, opens in a new tab</span>
            </a>
          </>
        }
      />

      <div className={PANEL_GRID}>
        <Panel title="Publication" span={6} bodyClassName="py-1.5">
          <Facts>
            <Fact term="Publication">{publicationLabel(screen)}</Fact>
            <Fact term="Source">
              {source ? (
                <a
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-cyan-600 underline decoration-line-strong underline-offset-2"
                >
                  {source.label} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">opens in a new tab</span>
                </a>
              ) : (
                NOT_RECORDED
              )}
            </Fact>
            <Fact term="Publication type">
              {screen.sourceType === "prepub" ? "Preprint, not yet peer reviewed in this record" : or(screen.sourceType === "pubmed" ? "Indexed in PubMed" : screen.sourceType)}
            </Fact>
            <Fact term="Curator rationale">{or(screen.rationale)}</Fact>
          </Facts>
        </Panel>

        <Panel title="Assay" span={6} bodyClassName="py-1.5">
          <Facts>
            <Fact term="Selection">{or(screen.screenType)}</Fact>
            <Fact term="Setup">{or(screen.setup)}</Fact>
            <Fact term="Condition">{condition ? condition : NOT_RECORDED}</Fact>
            <Fact term="Duration">{or(screen.duration)}</Fact>
            <Fact term="Multiplicity of infection">{or(screen.moi)}</Fact>
            <Fact term="Format">{[screen.screenFormat, screen.throughput].filter(Boolean).join(", ") || NOT_RECORDED}</Fact>
            <Fact term="Phenotype">{or(screen.phenotype)}</Fact>
          </Facts>
        </Panel>

        <Panel title="Cell model and library" span={6} bodyClassName="py-1.5">
          <Facts>
            <Fact term="Cell line">
              {screen.cellLine ? (
                <Link
                  href={`${atlasHref}?cell=${encodeURIComponent(screen.cellLine)}`}
                  className="text-cyan-600 underline decoration-line-strong underline-offset-2"
                >
                  {screen.cellLine}
                  <span className="sr-only">: see every screen in this cell line</span>
                </Link>
              ) : (
                NOT_RECORDED
              )}
            </Fact>
            <Fact term="Cell type">{or(screen.cellType)}</Fact>
            <Fact term="Library">{or(screen.library)}</Fact>
            <Fact term="Modality">
              {screen.modality ? [modalityLabel(screen.modality), screen.libraryMethodology].filter(Boolean).join(", ") : NOT_RECORDED}
            </Fact>
            <Fact term="Enzyme">{or(screen.enzyme)}</Fact>
            <Fact term="Targets promoters">
              {screen.targetsTss ? "Yes, guides target transcription start sites" : "No"}
            </Fact>
          </Facts>
        </Panel>

        <Panel
          title="The authors' hit definition"
          span={6}
          caveat="Verbatim from the record. Not comparable across screens."
          bodyClassName="py-1.5"
        >
          <Facts>
            <Fact term="Analysis">{or(screen.analysis)}</Fact>
            <Fact term="Rule">
              {rule ? (
                <code className="block whitespace-pre-wrap break-words rounded bg-mist-soft px-1.5 py-1 font-mono text-[11.5px] text-ink">
                  {rule}
                </code>
              ) : (
                NOT_RECORDED
              )}
            </Fact>
            <Fact term="Scores reported">{screen.scoreTypes.length > 0 ? screen.scoreTypes.join("; ") : NOT_RECORDED}</Fact>
            <Fact term="Genes reported">
              {screen.nGenes === null ? NOT_RECORDED : formatNumber(screen.nGenes)}
              {screen.hitListOnly && (
                <StatusChip tone="run" className="ml-2 align-middle">
                  Hit list only
                </StatusChip>
              )}
            </Fact>
            <Fact term="Called a hit">
              {screen.nHits === null ? NOT_RECORDED : formatNumber(screen.nHits)}
              {listedDiffers && (
                <span className="block text-[11px] text-muted">
                  {formatNumber(hits.total)} distinct gene symbols are listed below; repeated identifiers that
                  resolve to one symbol are listed once.
                </span>
              )}
            </Fact>
          </Facts>
          {screen.hitListOnly && (
            <p className="mt-2 rounded-md bg-orange-50 px-2.5 py-1.5 text-[11.5px] leading-snug text-orange-700">
              This record lists only the genes its authors called. A gene absent from it was not necessarily
              measured, so it cannot serve as a denominator for a hit rate.
            </p>
          )}
        </Panel>

        {screen.notes && (
          <Panel title="Curator notes" span={12} bodyClassName="py-2.5">
            <p className="max-w-4xl text-[12.5px] leading-relaxed text-body">{screen.notes}</p>
          </Panel>
        )}

        <Panel
          id="genes"
          title="Genes called by the authors"
          count={
            hitText
              ? `${formatNumber(hits.matching)} of ${formatNumber(hits.total)} match`
              : `${formatNumber(hits.total)} genes`
          }
          span={8}
          body="flush"
          className="min-h-[320px] self-start"
          footer={
            <>
              <FootNote>Alphabetical. Scores stay in the ORCS record.</FootNote>
              <FootLink href={`/dashboard/atlas/export?kind=hits&screen=${screen.id}`} download>
                Export CSV
                <span className="sr-only"> of every gene called in this screen</span>
              </FootLink>
            </>
          }
        >
          <form
            method="get"
            action={`${atlasScreenHref(screen.id)}#genes`}
            role="search"
            className="flex shrink-0 items-center gap-2 border-b border-line px-[var(--panel-gutter)] py-2"
          >
            <label htmlFor="hit-filter" className="sr-only">
              Filter genes in this screen
            </label>
            <input
              id="hit-filter"
              name="hq"
              type="search"
              defaultValue={hitText}
              placeholder="Filter genes, for example RPL"
              autoComplete="off"
              spellCheck={false}
              className="h-7 min-w-0 max-w-[260px] flex-1 rounded-md border border-line bg-white px-2 text-[12px] text-ink outline-none focus:border-cyan-500"
            />
            <button type="submit" className="btn btn-ghost h-7 rounded-md px-2.5 py-0 text-[11px]">
              Filter
            </button>
            {hitText && (
              <Link href={`${atlasScreenHref(screen.id)}#genes`} className="text-[11px] text-cyan-600 underline">
                Clear
              </Link>
            )}
            <nav aria-label="Gene pages" className="ml-auto flex items-center gap-2 text-[11px] text-muted">
              {hits.page > 1 ? (
                <Link className="rounded px-1.5 py-0.5 text-cyan-600 hover:bg-cyan-50" href={hitsHref(hits.page - 1)}>
                  Previous
                </Link>
              ) : (
                <span className="px-1.5 text-muted/60">Previous</span>
              )}
              <span className="num">
                {hits.pages > 1 ? `Page ${hits.page} of ${hits.pages}` : "One page"}
              </span>
              {hits.page < hits.pages ? (
                <Link className="rounded px-1.5 py-0.5 text-cyan-600 hover:bg-cyan-50" href={hitsHref(hits.page + 1)}>
                  Next
                </Link>
              ) : (
                <span className="px-1.5 text-muted/60">Next</span>
              )}
            </nav>
          </form>

          {hits.total === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-muted">
              {screen.nHits === 0
                ? "The authors called no genes in this screen."
                : "The Atlas holds no gene list for this screen."}
            </p>
          ) : hits.rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-muted">No called gene matches &ldquo;{hitText}&rdquo;.</p>
          ) : (
            <DenseTable minWidth={420} compact maxRows={22}>
              <caption className="sr-only">Genes called a hit by the original authors of screen {screen.id}</caption>
              <thead>
                <tr>
                  <Th>Gene</Th>
                  <Th align="right">Called in screens</Th>
                  <Th align="right">Measured in screens</Th>
                </tr>
              </thead>
              <tbody>
                {hits.rows.map((row) => (
                  <tr key={row.symbol} className={ROW_HIT}>
                    <td>
                      <Link
                        href={atlasGeneHref(row.symbol)}
                        className={cn("font-medium text-ink hover:text-orange-600", ROW_LINK)}
                      >
                        {row.symbol}
                        <span className="sr-only">: history in the Atlas</span>
                      </Link>
                    </td>
                    <td className="num-col">{formatNumber(row.calledElsewhere)}</td>
                    <td className="num-col">{formatNumber(row.tested)}</td>
                  </tr>
                ))}
              </tbody>
            </DenseTable>
          )}
        </Panel>

        <div className="col-span-12 flex min-h-0 flex-col gap-4 lg:col-span-4">
          <Panel
            title="Same cell line, same phenotype"
            span={12}
            className="col-span-12"
            bodyClassName="py-1.5"
            count={sameCell.length === 0 ? undefined : `${sameCell.length} nearest by year`}
          >
            {sameCell.length === 0 ? (
              <p className="py-2 text-[12px] text-muted">
                No other screen in this cell line records this phenotype.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {sameCell.map((other) => (
                  <li key={other.id}>
                    <Link
                      href={atlasScreenHref(other.id)}
                      className="flex items-baseline justify-between gap-2 py-1.5 text-[12px] text-ink hover:text-orange-600"
                    >
                      <span className="min-w-0 truncate">
                        {publicationLabel(other)}
                        {conditionLabel(other) && <span className="ml-1.5 text-muted">{conditionLabel(other)}</span>}
                      </span>
                      <span className="num shrink-0 text-[11px] text-muted">#{other.id}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Overlapping hit calls"
            span={12}
            className="col-span-12"
            bodyClassName="py-1.5"
            caveat="Proliferation screens overlap because they share essential genes."
          >
            {similar.length === 0 ? (
              <p className="py-2 text-[12px] text-muted">
                Needs at least ten called genes here and in the other screen, with three or more shared.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {similar.map(({ screen: other, shared, jaccard }) => (
                  <li key={other.id}>
                    <Link
                      href={atlasScreenHref(other.id)}
                      className="block py-1.5 text-[12px] text-ink hover:text-orange-600"
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate">{publicationLabel(other)}</span>
                        <span className="num shrink-0 text-[11px] text-muted">#{other.id}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted">
                        {[other.cellLine, other.phenotype].filter(Boolean).join(", ")}
                      </span>
                      <span className="num mt-0.5 block text-[11px] text-body">
                        {formatNumber(shared)} shared genes, overlap {(jaccard * 100).toFixed(1)}%
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <p className="text-[11px] text-muted">
        Record from BioGRID ORCS {manifest.release} (MIT licence, Copyright 2021 Mike Tyers). Fields are shown as the
        curators recorded them.
      </p>
    </div>
  );
}
