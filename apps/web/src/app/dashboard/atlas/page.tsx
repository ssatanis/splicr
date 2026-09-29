/**
 * Atlas: published CRISPR screens, with their sources.
 *
 * The Atlas is public reference data (BioGRID ORCS, MIT licensed), so this page
 * is the same for a demo visitor and for a workspace member and reads no
 * workspace row. It answers two questions, in this order: which published
 * screens resemble mine, and what has been found about this gene before.
 *
 * Every screen keeps the analysis method and hit rule its own authors used. The
 * page never re-scores a screen and never adds hits across screens as if they
 * shared a definition; it counts how many screens called a gene.
 */
import { AtlasFilters, GeneFinder } from "@/components/dashboard/atlas/controls";
import { GenePanel } from "@/components/dashboard/atlas/gene-panel";
import { AtlasPager, AtlasScreensTable } from "@/components/dashboard/atlas/screens-table";
import { FootLink, FootNote, PageHeader, Panel } from "@/components/dashboard/ui";
import { ORCS_HOME } from "@/lib/atlas/links";
import { hrefWith, parseScreenQuery } from "@/lib/atlas/params";
import { corpusFigures, lookupGene, queryScreens } from "@/lib/atlas/query";
import { getAtlasGenes, getAtlasManifest, getAtlasScreenMap, getAtlasScreens } from "@/lib/atlas/store";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Atlas" };

const BASE = "/dashboard/atlas";

export default async function AtlasPage(props: PageProps<"/dashboard/atlas">) {
  const query = parseScreenQuery(await props.searchParams);
  const manifest = getAtlasManifest();
  const corpus = getAtlasScreens();
  const figures = corpusFigures(corpus);

  // The 6 MB gene table is only read when a gene is asked about.
  const genes = query.gene !== null ? getAtlasGenes() : null;
  const lookup = genes && query.gene ? lookupGene(genes, getAtlasScreenMap(), query.gene) : null;
  const page = queryScreens(corpus, genes, query);

  // A gene the Atlas does not have would otherwise read as "no screen called
  // it", which is a different and false statement.
  const geneMissing = lookup?.status === "not_found";

  const exportHref = hrefWith(`${BASE}/export`, query, { page: null });

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <PageHeader
        dense
        title="Atlas"
        body={`${formatNumber(figures.screens)} human screens from ${formatNumber(figures.publications)} publications, from BioGRID ORCS ${manifest.release}.`}
        actions={<GeneFinder active={lookup?.status === "found" ? lookup.gene.symbol : null} />}
      />

      {lookup && <GenePanel lookup={lookup} query={query} />}

      {!geneMissing && (
        <Panel
          title={lookup?.status === "found" ? `Screens that called ${lookup.gene.symbol}` : "Published screens"}
          count={`${formatNumber(page.total)} of ${formatNumber(page.corpus)}`}
          caveat="Each screen keeps its authors' own analysis and hit rule. Compare the record, not the count."
          body="flush"
          className="min-h-[360px] lg:flex-1"
          footer={
            <>
              <FootNote className="hidden md:block">
                BioGRID ORCS {manifest.release}, MIT licence. Human screens only.{" "}
                <a
                  href={ORCS_HOME}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-600 underline decoration-line-strong underline-offset-2"
                >
                  Source
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </FootNote>
              <span className="ml-auto flex shrink-0 items-center gap-4">
                <AtlasPager
                  page={page.page}
                  pages={page.pages}
                  total={page.total}
                  pageSize={page.pageSize}
                  query={query}
                  basePath={BASE}
                />
                <FootLink href={exportHref} download>
                  Export CSV
                  <span className="sr-only"> of every screen matching these filters</span>
                </FootLink>
              </span>
            </>
          }
        >
          <AtlasFilters facets={page.facets} yearRange={page.yearRange} total={page.total} corpus={page.corpus} />
          <AtlasScreensTable rows={page.rows} query={query} basePath={BASE} />
        </Panel>
      )}
    </div>
  );
}
