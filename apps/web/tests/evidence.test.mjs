/* Real research artifact consistency and rendering; contact tests never send email. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = path.resolve(import.meta.dirname, "../../..");
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const evidence = readJson("apps/web/public/evidence/summary.json");
function load(relative, overrides = {}) {
  const filename = path.join(root, relative);
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const native = createRequire(filename);
  const exports = {};
  const adapter = (name) => {
    if (name in overrides) return overrides[name];
    if (name === "@/lib/content") return load("apps/web/src/lib/content.ts");
    if (name === "@/lib/marketing-metadata") return load("apps/web/src/lib/marketing-metadata.ts");
    if (name === "@/lib/site") return load("apps/web/src/lib/site.ts");
    if (name === "@/components/marketing/nav") return { MarketingNav: () => null };
    if (name === "@/components/ui/reveal") return { Reveal: ({ children }) => children };
    if (name === "next/link") return function TestLink({ children, ...props }) { return React.createElement("a", props, children); };
    // Any other "@/..." resolves to the real source file, so importing a new
    // component into a tested page does not need a line added here. The stubs
    // above are checked first and still win.
    if (name.startsWith("@/")) {
      const base = path.join("apps/web/src", name.slice(2));
      for (const ext of [".tsx", ".ts"]) {
        if (fs.existsSync(path.join(root, base + ext))) return load(base + ext);
      }
    }
    return native(name);
  };
  vm.runInNewContext(output, { exports, require: adapter, URL, ...overrides.globals });
  return exports;
}

test("public evidence exactly regenerates from actual research artifacts", () => {
  execFileSync(process.execPath, ["scripts/research/evidence_gate.mjs", "--check-public"], { cwd: root });
  for (const [name, expected] of Object.entries(evidence.sources_sha256)) {
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex"), expected);
  }
});

test("published download checksums match every downloadable artifact", () => {
  const manifest = readJson("apps/web/public/evidence/manifest.json");
  for (const [name, expected] of Object.entries(manifest.files_sha256)) {
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(root, "apps/web/public/evidence", name))).digest("hex"), expected);
  }
});

test("website benchmark values are the measured values, with one SplicR row and an honest tie", () => {
  const { benchmark } = load("apps/web/src/lib/content.ts");
  const splicr = benchmark.filter(b => b.label.includes("SplicR"));
  assert.equal(splicr.length, 1);
  const matched = benchmark.find(b => b.label.includes("same gene library"));
  const shipped = benchmark.find(b => b.label.includes("as published"));
  const log = fs.readFileSync(path.join(root, "research/artifacts/archived_router_reproduction.log"), "utf8");
  const grab = re => Number(log.match(re)[1]);
  const router = grab(/TEST official AnDCG@100 (\S+)/);
  const dense = grab(/TEST densified published ensemble (\S+)/);
  const [lo, hi] = log.match(/interval (?:\S+ )?\[(\S+), (\S+)\]/).slice(1).map(Number);
  assert.ok(Math.abs(splicr[0].value - router) < 5e-6);
  assert.ok(Math.abs(matched.value - dense) < 5e-6);
  const screens = readJson("research/artifacts/reference_published_ensemble_screens.json");
  const published = screens.reduce((sum, s) => sum + s["adjusted_ndcg@100"], 0) / screens.length;
  assert.ok(Math.abs(shipped.value - published) < 5e-6);
  // The matched difference is a tie, so the page must not present it as a win.
  assert.ok(lo < 0 && hi > 0);
  assert.equal(splicr[0].value.toFixed(3), "0.220");
  assert.equal(matched.value.toFixed(3), "0.219");
});

test("technology benchmark copy matches the measurements and does not overclaim", () => {
  const page = fs.readFileSync(path.join(root, "apps/web/src/app/(marketing)/technology/page.tsx"), "utf8");
  const body = page.match(/body="(SplicR, built on[^"]+)"/)[1];
  const rep = evidence.post_screen_replication;
  const perTen = v => (v * 10).toFixed(1);
  assert.ok(body.includes(`${perTen(rep.precision_at_10.primary)} of its top ten`));
  assert.ok(body.includes(`up from ${perTen(rep.precision_at_10.comparator)} on effect size alone`));
  assert.ok(body.includes("ties the frontier ensemble on the same library, 0.220 to 0.219"));
  // The replication result is a separate, research-only task and must be cited as one.
  const { replicationCite } = load("apps/web/src/lib/content.ts");
  assert.equal(rep.promotion_status, "research_only");
  assert.match(replicationCite.text, /separate research-only task/);
  assert.match(replicationCite.note, /not wet-lab validation/);
  assert.equal(replicationCite.href, "/evidence#post-screen");
  // No "beats all" style claim anywhere in the section copy.
  assert.doesNotMatch(body, /beats? (all|every)|state.of.the.art|best|outperform/i);
});

test("homepage report renders actual nonsignificant result and QC limitation", () => {
  const { HitReportPreview } = load("apps/web/src/components/marketing/sections/hit-report-preview.tsx");
  const html = renderToStaticMarkup(React.createElement(HitReportPreview));
  const measured = readJson("research/artifacts/postscreen_unpaired_audit.json");
  for (const value of [measured.CHD1L.lfc, measured.CHD1L.depleted_fdr, measured.CHD1L.drugz_fdr]) assert.ok(html.includes(String(value)));
  assert.match(html, /QC failed/);
  assert.match(html, /not significant/);
  assert.doesNotMatch(html, /Chance real|91%|ACSL4/);
});

test("evidence page renders exact measurements, uncertainty and downloadable sources", () => {
  const { default: EvidencePage } = load("apps/web/src/app/(marketing)/evidence/page.tsx");
  const html = renderToStaticMarkup(React.createElement(EvidencePage));
  for (const value of ["0.160369", "0.163091", "-0.015581", "0.006268", "26,336,701", "0.9289", "0.9548"]) assert.ok(html.includes(value), value);
  assert.match(html, /not an untouched prospective cohort/);
  assert.match(html, /post-hoc notes, significance criteria and ranking rationale/);
  assert.match(html, /does not establish a clean pre-experiment historical forecast/);
  assert.doesNotMatch(html, /before seeing target measurements/);
  assert.match(html, /workspace access is not enabled/);
  assert.match(html, /summary.json/);
  assert.doesNotMatch(html, /Chance real|calibrated confidence for every/);
});

/**
 * The form posts to /api/demo-request and sends a real email, so unlike the
 * mailto draft it replaced it *can* claim delivery. The guarantee that still has
 * to hold is that it only claims it when the request actually succeeded: a failed
 * send must surface the failure, never a confirmation.
 */
function contactForm({ ok, payload = {}, thrown = null }) {
  const slots = [];
  let cursor = 0;
  const fakeReact = {
    useState(initial) {
      const i = cursor++;
      if (slots.length <= i) slots.push(initial);
      return [slots[i], (next) => { slots[i] = next; }];
    },
  };
  const fields = new Map([["name", "Ada Lovelace"], ["company", "Lab"],
                          ["email", "a@example.test"], ["message", "q=1 & #2"], ["website", ""]]);
  const calls = [];
  const globals = {
    FormData: class { get(k) { return fields.get(k); } },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (thrown) throw thrown;
      return { ok, json: async () => payload };
    },
  };
  const { ContactForm } = load("apps/web/src/components/marketing/contact-form.tsx",
    { react: fakeReact, globals });
  const render = () => { cursor = 0; return ContactForm(); };
  return { render, calls, slots };
}

test("contact form posts the request and confirms only on success", async () => {
  const { render, calls, slots } = contactForm({ ok: true });
  let prevented = false, reset = false;
  await render().props.onSubmit({
    preventDefault() { prevented = true; },
    currentTarget: { reset() { reset = true; } },
  });
  assert.ok(prevented, "the native form submission must be prevented");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/demo-request");
  assert.equal(calls[0].init.method, "POST");
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.email, "a@example.test");
  assert.equal(sent.message, "q=1 & #2");
  assert.equal(sent.topic, "Blinded evaluation");
  assert.ok(reset, "a successful send must clear the form");
  assert.equal(slots.at(-1).kind, "sent");
  const html = renderToStaticMarkup(render());
  assert.match(html, /Thanks, Ada/);
  assert.match(html, /confirmation is on its way/);
});

test("contact form shows a failed send as an error, never as a confirmation", async () => {
  for (const scenario of [
    { ok: false, payload: { error: "Rate limited" }, expect: /Rate limited/ },
    { ok: false, payload: {}, expect: /Something went wrong/ },
    { thrown: new Error("offline"), ok: false, expect: /could not reach the server/i },
  ]) {
    const { render, slots } = contactForm(scenario);
    await render().props.onSubmit({ preventDefault() {}, currentTarget: { reset() {} } });
    assert.equal(slots.at(-1).kind, "error", JSON.stringify(scenario.payload ?? {}));
    const html = renderToStaticMarkup(render());
    assert.match(html, scenario.expect);
    assert.match(html, /role="alert"/);
    // The confirmation copy must not appear on any failure path.
    assert.doesNotMatch(html, /Thanks, Ada|confirmation is on its way|Request received/);
  }
});
