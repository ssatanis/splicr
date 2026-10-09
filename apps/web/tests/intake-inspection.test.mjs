import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {loadTs} from './helpers/load-ts.mjs';
function inspector(bytes) {return loadTs('lib/intake/inspect.ts',{mocks:{'server-only':{},'@/lib/supabase/server':{createClient:async()=>({rpc:async()=>({data:[],error:null})})},'@/lib/supabase/env':{supabaseUrl:'https://test.invalid'},'./r2.server':{parseR2Uri:()=>({}),headR2:async()=>bytes.length,readR2Head:async()=>bytes}}});}
const counts=Buffer.from('guide,gene,T0,treated\ng1,A1BG,100,10\ng2,BRAF,50,30\n');
test('gzip count inspection decodes contents and exposes editable table columns',async()=>{
 const shape=await inspector(gzipSync(counts)).inspectStoredFile('r2://fixture','counts',true,'counts.csv.gz');
 assert.equal(shape.ok,true);assert.equal(shape.kind,'counts');assert.deepEqual(shape.table.sample_columns,['T0','treated']);assert.equal(shape.table.gene_column,'gene');
});
test('inconsistent gzip names are actionable failures rather than accepted inputs that fail at runtime',async()=>{
 const plain=await inspector(counts).inspectStoredFile('r2://fixture','counts',true,'counts.csv.gz');assert.equal(plain.ok,false);assert.match(plain.error,/not gzip/);
 const compressed=await inspector(gzipSync(counts)).inspectStoredFile('r2://fixture','counts',false,'counts.csv');assert.equal(compressed.ok,false);assert.match(compressed.error,/Add .gz/);
});
test('FASTQ content in a text file is detected from records, not its extension',async()=>{
 const reads=Buffer.from('@r1\nACGTACGTACGTACGTACGT\n+\nIIIIIIIIIIIIIIIIIIII\n');
 const shape=await inspector(reads).inspectStoredFile('r2://fixture','counts',false,'reads.txt');assert.equal(shape.ok,true);assert.equal(shape.kind,'fastq');assert.equal(shape.read_length,20);
});
