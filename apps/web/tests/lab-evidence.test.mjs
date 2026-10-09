import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { loadTs, srcPath } from './helpers/load-ts.mjs';
const lab = loadTs(srcPath('lib/lab/memory.ts'));
const options = loadTs(srcPath('lib/lab/options.ts'));
const figures = loadTs(srcPath('lib/lab/figures.ts'));
const exports = loadTs(srcPath('lib/report/lab-evidence-export.ts'));
function record(kind, payload, gene='PIKFYVE') {
  const body = {schema:'splicr.lab-evidence.v1',gene,kind,inputs:{counts_sha256:'real-byte-identity-fixture'},payload};
  const canonical=JSON.stringify(body);
  return {...body,canonical,sha256:createHash('sha256').update(canonical).digest('hex')};
}
const index = {table:{symbols:['PIKFYVE','TP53','PIK3CA','GENE1','GENE2']},bySymbol:new Map(['PIKFYVE','TP53','PIK3CA','GENE1','GENE2'].map(s=>[s,1])),byAlias:new Map([['P53','TP53']])};

test('PIKFYE resolves visibly, aliases resolve deterministically and ambiguity is not hidden',()=>{
  assert.deepEqual(lab.resolveGene('pikfye',index),{query:'PIKFYE',symbol:'PIKFYVE',kind:'suggested',suggestions:['PIKFYVE']});
  assert.equal(lab.resolveGene('p53',index).kind,'alias');
  assert.equal(lab.resolveGene('gene',index).kind,'ambiguous');
  assert.equal(lab.resolveGene('gene',index).symbol,null);
  assert.equal(lab.resolveGene('BAD,GENE',index).symbol,null);
  assert.equal(lab.resolveGene('CUSTOM123',index).symbol,'CUSTOM123');
});
test('time settings retain independent biological trajectories, refuse duplicate times and unavailable samples',()=>{
  const points = [0,7,21].map((day,i)=>({sample:`s${i}`,day,replicate:'culture1',condition:'vehicle'}));
  assert.equal(options.validateLabOptions({time_course:points},['s0','s1','s2']),null);
  assert.match(options.validateLabOptions({time_course:points.slice(0,2)},['s0','s1']),/three/);
  assert.match(options.validateLabOptions({time_course:points},['s0','s1']),/selected/);
  assert.match(options.validateLabOptions({time_course:[points[0],{...points[1],day:0},points[2]]},['s0','s1','s2']),/distinct/);
  assert.ok(options.validateLabOptions({time_course:[{...points[0],day:NaN}]},['s0']));
  assert.ok(options.validateLabOptions({isoforms:true,transcript_expression:{T1:-1},expression_source:'sample'},[]));
});
test('measured transcript imports preserve zeros and reject blanks, duplicates and gene-level headers',()=>{
  assert.deepEqual(options.parseTranscriptExpression('transcript_id\tTPM\nENST1\t0\nENST2\t10.2'),{ENST1:0,ENST2:10.2});
  for(const text of ['transcript_id\tTPM\nENST1\t','transcript_id\tTPM\nENST1\t0\nENST1\t2','gene\tTPM\nPIKFYVE\t10','{"ENST1":null}','{"ENST1":0,"ENST1":2}','{"ENST1":0,"\\u0045NST1":2}','{"ENST1":-1}']) assert.throws(()=>options.parseTranscriptExpression(text));
});
test('offline bundle includes original verified bytes, every individual vector figure and checksums',()=>{
  const r=record('kinetics',{status:'measured',conditions:[{condition:'vehicle',slope:0,n_replicates:1,ci95:null,standard_error:null}],trajectories:[{condition:'vehicle',replicate:'culture1',days:[0,7,21],samples:['s0','s1','s2'],mean_lfc:[0,0,-1],slope:-.05,intercept:.1,residual_rmse:.2,guides:[{guide_key:'g1',lfc:[0,0,-1],counts:[100,100,50]}]}]});
  const files=unzipSync(exports.labEvidenceBundle([r],{screen_id:'test',run_id:'test'}));
  const manifest=JSON.parse(strFromU8(files['manifest.json']));
  for(const item of manifest.files) {
    assert.ok(files[item.path]);
    assert.equal(files[item.path].length,item.byte_length);
    assert.equal(createHash('sha256').update(files[item.path]).digest('hex'),item.sha256);
  }
  const original=Object.keys(files).find(p=>p.endsWith('/receipt.canonical.json'));
  assert.equal(strFromU8(files[original]),r.canonical);
  assert.ok(Object.keys(files).some(p=>p.endsWith('.svg')));
  assert.ok(Object.keys(files).some(p=>p.endsWith('.pdf')));
  assert.ok(Object.keys(files).some(p=>p.endsWith('.spec.json')));
  const html=strFromU8(files['index.html']);
  assert.ok(html.includes("addEventListener('input'"));
  assert.ok(!/<script[^>]+src=|https:\/\/cdn/.test(html));
  assert.throws(()=>exports.labEvidenceBundle([{...r,canonical:r.canonical+' '}],{}),/SHA-256/);
  assert.throws(()=>exports.labEvidenceBundle([{...r,gene:'OTHER'}],{}),/canonical receipt/);
});
test('chart labels cannot inject HTML, and unknown measurements do not plot as zero',()=>{
  const r=record('context',{status:'not_measured',model_id:'<script>alert(1)</script>',exact:{status:'not_measured',effect:null},lineage_reference:{n_measured_models:0,median_effect:null},global_reference:{n_measured_models:0,median_effect:null}});
  const scene=figures.evidenceScenes(r)[0];
  const svg=figures.sceneSvg(scene);
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.ok(!svg.includes('<script>'));
  assert.equal(scene.marks.filter(m=>m.type==='line').length,0);
  const html=strFromU8(unzipSync(exports.labEvidenceBundle([r],{}))['index.html']);
  assert.equal((html.match(/<script>/g)??[]).length,1);
});
test('PDF object offsets, stream byte length and geometry are internally consistent',()=>{
  const scene=figures.curves('Measured curve',[{name:'vehicle',points:[[0,0],[7,-1],[21,-2]]}],'Days','Log2FC');
  const pdf=new TextDecoder().decode(figures.scenePdf(scene));
  assert.ok(pdf.startsWith('%PDF-1.4'));
  const startxref=Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(startxref,startxref+4),'xref');
  const content=pdf.match(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
  assert.equal(Number(content[1]),content[2].length);
  assert.ok(pdf.includes(`/MediaBox [0 0 ${scene.width} ${scene.height}]`));
});
test('recorded UI displays missing context distinctly and gives per-gene downloads',()=>{
  const { RecordedLabEvidence }=loadTs(srcPath('components/dashboard/evidence/lab-evidence-panel.tsx'), {globals:{React}});
  const r=record('context',{status:'not_measured',exact:{status:'not_measured',effect:null},global_reference:{n_measured_models:0,median_effect:null,mean_effect:null,fraction_effect_le_minus_0_5:null}});
  const html=renderToStaticMarkup(React.createElement(RecordedLabEvidence,{records:[r],downloadHref:'/test-download'}));
  assert.ok(html.includes('Not measured'));
  assert.ok(html.includes('/test-download'));
  assert.ok(html.includes(r.sha256));
});
