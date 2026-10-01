/**
 * The Atlas pages and export route, executed for real against the committed
 * snapshot. Client-only controls are stubbed (they need a browser router); every
 * server component, loader and route handler is the shipped code.
 */
import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { loadTs } from "./helpers/load-ts.mjs";

const realStore = loadTs("lib/atlas/store.ts", { mocks: { "server-only": {} } });

let geneReads = 0;
const store = {
  ...realStore,
  getAtlasGenes: () => {
    geneReads++;
    return realStore.getAtlasGenes();
  },
};

class NotFound extends Error {}
// next/link's routing props are not DOM attributes; keep only what an <a> takes.
const ROUTING_PROPS = new Set(["replace", "scroll", "prefetch"]);
function anchor({ href, children, ...rest }) {
  const dom = Object.fromEntries(Object.entries(rest).filter(([key]) => !ROUTING_PROPS.has(key)));
  return React.createElement("a", { href, ...dom }, children);
}
const stub = (name) => function Stub() { return React.createElement("div", { "data-stub": name }); };

const mocks = {
  "server-only": {},
  "next/link": { __esModule: true, default: anchor },
  "next/navigation": { notFound: () => { throw new NotFound(); } },
  "@/lib/atlas/store": store,
  "@/components/dashboard/atlas/controls": { AtlasFilters: stub("filters"), GeneFinder: stub("finder") },
};

const atlasPage = loadTs("app/dashboard/atlas/page.tsx", { mocks }).default;
const screenPage = loadTs("app/dashboard/atlas/screens/[id]/page.tsx", { mocks });
const exportRoute = loadTs("app/dashboard/atlas/export/route.ts", {
  mocks: {
    ...mocks,
    "next/server": {
      NextResponse: class extends Response {
        static json(body, init) {
          return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", ...init?.headers } });
        }
      },
    },
  },
});

const render = async (page, props) => renderToStaticMarkup(await page(props));
const params = (search = {}) => ({ searchParams: Promise.resolve(search) });

test("the default page lists fifty screens, states its provenance and never loads the gene table", async () => {
  geneReads = 0;
  const html = await render(atlasPage, params());
  assert.equal((html.match(/<tr class="row-hit"/g) ?? []).length, 50);
  assert.match(html, /1&#x27;?[––-]50 of 1,952|1–50 of 1,952/);
  // Provenance moved to one place. The page used to say where the records come
  // from three times over: a subtitle, a caveat strip and the footer. The
  // footer is the one that stays, because it is beside the licence and the
  // link, and it is still asserted here.
  assert.match(html, /BioGRID ORCS 2\.0\.18, MIT licence/);
  assert.ok(
    !/human screens from .* publications/.test(html),
    "the corpus subtitle is gone and does not come back",
  );
  assert.ok(
    !/own analysis and hit rule/.test(html),
    "and so is the caveat strip that repeated it",
  );
  assert.equal(geneReads, 0, "the 6 MB gene table is not read unless a gene is asked about");
});

test("every row links to its own record and carries an accessible name", async () => {
  const html = await render(atlasPage, params({ sort: "id", dir: "asc" }));
  assert.match(html, /href="\/dashboard\/atlas\/screens\/1"/);
  assert.match(html, /Wang T \(2014\)/);
  assert.match(html, /open this screen&#x27;s record/);
});

test("sorting is a link, marks the sorted column and reverses on a second visit", async () => {
  const html = await render(atlasPage, params({ sort: "nHits", dir: "desc" }));
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /href="\/dashboard\/atlas\?sort=nHits&amp;dir=asc"/);
  const rowsInOrder = [...html.matchAll(/<td class="num-col">([\d,]+)<\/td><td class="num-col">(\d{4})<\/td>/g)];
  assert.ok(rowsInOrder.length > 0);
});

test("a gene page shows the gene, its denominator, and only the screens that called it", async () => {
  const html = await render(atlasPage, params({ gene: "tp53" }));
  assert.match(html, /TP53/);
  assert.match(html, /NCBI Gene 7157/);
  assert.match(html, /screens that measured it/);
  assert.match(html, /95% interval/);
  assert.match(html, /Screens that called TP53/);
  assert.match(html, /Counts screens, not effect sizes/);
  assert.equal(geneReads > 0, true);
});

test("an alias says what it became and a rare gene is not given a frequent-hitter verdict", async () => {
  const html = await render(atlasPage, params({ gene: "p53" }));
  assert.match(html, /shown for (&ldquo;|“)p53/);
  const scarce = realStore.getAtlasGenes().table.symbols.find(
    (_, i) => realStore.getAtlasGenes().table.testedBackground[i] > 0 && realStore.getAtlasGenes().table.testedBackground[i] < 10,
  );
  const page = await render(atlasPage, params({ gene: scarce }));
  assert.match(page, /Not judged/);
  assert.match(page, /Needs 10 or more background screens/);
});

test("an unknown gene is a clear dead end with a way out, not an empty table", async () => {
  const html = await render(atlasPage, params({ gene: "TP5" }));
  assert.match(html, /Gene not found/);
  assert.match(html, /Did you mean/);
  assert.match(html, /href="\/dashboard\/atlas\?gene=TP53"/);
  assert.doesNotMatch(html, /<table/);
});

test("filters that match nothing say so and offer to clear themselves", async () => {
  const html = await render(atlasPage, params({ q: "zzzzqqqq" }));
  assert.match(html, /No screen matches these filters/);
  assert.match(html, /Clear the filters/);
});

test("a hostile query string cannot break the page or inject markup", async () => {
  const html = await render(atlasPage, params({ q: "<script>alert(1)</script>", sort: "x'; DROP", page: "NaN", gene: '"><img src=x>' }));
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test("the record page prints the authors' hit rule verbatim and reconciles the hit count", async () => {
  const html = await render(screenPage.default, { params: Promise.resolve({ id: "5" }), searchParams: Promise.resolve({}) });
  assert.match(html, /Gilbert LA \(2014\)/);
  assert.match(html, /Score Significance: Score\.1 \(Gamma \(normalized log2e\/t\)\) &lt;= -0\.1/);
  assert.match(html, /1,345/);
  assert.match(html, /1,344 distinct gene symbols are listed below/);
  assert.match(html, /href="https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/25307932\/"/);
  assert.match(html, /href="https:\/\/orcs\.thebiogrid\.org\/Screen\/5"/);
  assert.match(html, /Same cell line, same phenotype/);
  assert.match(html, /Overlapping hit calls/);
});

test("a preprint links to its DOI, not a made-up PubMed id", async () => {
  const html = await render(screenPage.default, { params: Promise.resolve({ id: "1712" }), searchParams: Promise.resolve({}) });
  assert.match(html, /href="https:\/\/doi\.org\/10\.1101\/2021\.01\.19\.427194"/);
  assert.doesNotMatch(html, /pubmed\.ncbi\.nlm\.nih\.gov\/null/);
  assert.match(html, /Preprint/);
});

test("a hit-list-only screen warns that absence is not evidence of measurement", async () => {
  const listOnly = realStore.getAtlasScreens().find((screen) => screen.hitListOnly);
  const html = await render(screenPage.default, { params: Promise.resolve({ id: String(listOnly.id) }), searchParams: Promise.resolve({}) });
  assert.match(html, /Hit list only/);
  assert.match(html, /was not necessarily\s+measured/);
});

test("the record page filters its gene list by text and pages it", async () => {
  const busiest = realStore.getAtlasScreens().reduce((a, b) => ((b.nHits ?? 0) > (a.nHits ?? 0) ? b : a));
  const filtered = await render(screenPage.default, { params: Promise.resolve({ id: String(busiest.id) }), searchParams: Promise.resolve({ hq: "RPL" }) });
  assert.match(filtered, /match/);
  assert.match(filtered, />RPL\d/);
  const paged = await render(screenPage.default, { params: Promise.resolve({ id: String(busiest.id) }), searchParams: Promise.resolve({ hpage: "2" }) });
  assert.match(paged, /Page 2 of/);
});

test("ids that are not screens are a 404, never a crash or a blank page", async () => {
  for (const id of ["abc", "-1", "0.5", "99999999", "12345678901234567890", "1;2"]) {
    await assert.rejects(() => render(screenPage.default, { params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }), NotFound, id);
  }
});

test("export: the address that made the table makes the file", async () => {
  const response = await exportRoute.GET(new Request("http://x/dashboard/atlas/export?q=hap1&modality=knockout&hits=1"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /attachment; filename="splicr-atlas-screens_orcs-2\.0\.18_\d{4}-\d{2}-\d{2}\.csv"/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  // Response.text() drops a UTF-8 BOM, so read the bytes to see that it is there.
  const bytes = new Uint8Array(await response.clone().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const body = await response.text();
  assert.ok(body.startsWith("# SplicR Atlas"));
  assert.match(body, /# licence: MIT, Copyright 2021 Mike Tyers/);
  assert.match(body, /# filters: search "hap1"; modality = knockout; only screens with called genes/);
  const lines = body.trimEnd().split("\r\n");
  const headerAt = lines.findIndex((line) => line.startsWith("atlas_release,"));
  assert.ok(headerAt > 0);
  assert.equal(lines.length - headerAt - 1, Number(body.match(/# rows: (\d+) screens/)[1]));
  assert.ok(lines.slice(headerAt + 1).every((line) => line.startsWith('"2.0.18",')));
});

test("export: an empty result is a file with a header, not an error", async () => {
  const response = await exportRoute.GET(new Request("http://x/dashboard/atlas/export?q=zzzzqqqq"));
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /# rows: 0 screens/);
  assert.match(body, /atlas_release,screen_id/);
});

test("export: a screen's gene list is exactly its distinct hit symbols", async () => {
  const response = await exportRoute.GET(new Request("http://x/dashboard/atlas/export?kind=hits&screen=1"));
  assert.equal(response.status, 200);
  const body = await response.text();
  const rows = body.trimEnd().split("\r\n").filter((line) => line.startsWith('"2.0.18",1,'));
  assert.deepEqual(rows.map((line) => line.split(",")[2]), ['"CDK6"', '"MYB"', '"RPL36"', '"TAF3"', '"TOP2A"']);
  assert.match(body, /# authors_hit_rule: Score Significance: Score\.1/);
});

test("export: bad and unknown screen ids fail with a JSON error", async () => {
  for (const [screen, status] of [["abc", 400], ["", 400], ["-1", 400], ["99999", 404]]) {
    const response = await exportRoute.GET(new Request(`http://x/dashboard/atlas/export?kind=hits&screen=${screen}`));
    assert.equal(response.status, status, `screen=${screen}`);
    assert.match(response.headers.get("content-type"), /json/);
  }
});

test("export: spreadsheet formulas in free text are defused and date-like symbols are named", async () => {
  const csv = loadTs("lib/atlas/csv.ts");
  const manifest = realStore.getAtlasManifest();
  const screen = { ...realStore.getAtlasScreens()[0], author: "=HYPERLINK(\"http://evil\")", notes: "x" };
  const out = csv.screensCsv([screen], manifest, {}, new Date("2026-01-01T00:00:00Z"));
  assert.match(out, /"'=HYPERLINK\(""http:\/\/evil""\)"/);
  const hits = csv.hitsCsv(realStore.getAtlasScreens()[0], ["MARCH1", "SEPT9", "TP53", "DEC1"], manifest, new Date());
  assert.match(hits, /# excel_warning: 3 gene symbol\(s\)/);
  assert.match(hits, /MARCH1, SEPT9, DEC1/);
});
