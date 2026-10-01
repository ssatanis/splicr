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
import { lookupGene, queryScreens } from "@/lib/atlas/query";
import { getAtlasGenes, getAtlasManifest, getAtlasScreenMap, getAtlasScreens } from "@/lib/atlas/store";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Atlas" };

const BASE = "/dashboard/atlas";

export default async function AtlasPage(props: PageProps<"/dashboard/atlas">) {
  const query = parseScreenQuery(await props.searchParams);
  const manifest = getAtlasManifest();
  const corpus = getAtlasScreens();

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
      {/* No subtitle. The corpus size is the panel's own count below, with its
          denominator, and the release and licence are in the panel footer, so a
          line here was the third statement of provenance on one screen. The
          publication count that used to live here is no longer shown anywhere;
          it belongs on a corpus page rather than above a search field. */}
      <PageHeader
        dense
        title="Atlas"
        actions={<GeneFinder active={lookup?.status === "found" ? lookup.gene.symbol : null} />}
      />

      {lookup && <GenePanel lookup={lookup} query={query} />}

      {!geneMissing && (
        <Panel
          title={lookup?.status === "found" ? `Screens that called ${lookup.gene.symbol}` : "Published screens"}
          count={`${formatNumber(page.total)} of ${formatNumber(page.corpus)}`}
          /* Not decoration and not a duplicate of the footer's licence line: it is
             the one statement that stops a reader comparing two screens' hit counts,
             which they are not comparable, because each screen kept its authors'
             own rule. docs/11-console-modules.md states the same rule. */
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
