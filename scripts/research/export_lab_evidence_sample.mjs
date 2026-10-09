/** Exercise actual export bytes and offline interaction with real/synthetic scope labels. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {loadTs} from '../../apps/web/tests/helpers/load-ts.mjs';
const out=resolve('research/artifacts/20261008/lab-evidence');
const records=JSON.parse(readFileSync(resolve(out,'records.json'),'utf8'));
const {isLabReceipt}=loadTs('lib/lab/evidence.ts');
assert.ok(records.every(isLabReceipt),'Python receipts must satisfy the actual web contract');
const {labEvidenceBundle}=loadTs('lib/report/lab-evidence-export.ts');
const bytes=labEvidenceBundle(records,{scope:'Local software verification. Real Millman count diagnostics, real reference-only PIKFYVE maps/DepMap, explicitly synthetic kinetics. No database screen or biological validation created.'});
writeFileSync(resolve(out,'sample-evidence-bundle.zip'),bytes);
const files=unzipSync(bytes);
const manifest=JSON.parse(strFromU8(files['manifest.json']));
for(const item of manifest.files){assert.equal(files[item.path].byteLength,item.byte_length);assert.equal(createHash('sha256').update(files[item.path]).digest('hex'),item.sha256);}
for(const [name,content] of Object.entries(files)){const target=resolve(out,'extracted',name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);}
assert.equal(Object.keys(files).filter(p=>p.endsWith('.pdf')).length,5);
console.log(JSON.stringify({verified:true,receipts:records.length,pdf_figures:5,listed_files:manifest.files.length,bytes:bytes.byteLength,offline_html:resolve(out,'extracted/index.html')}));
