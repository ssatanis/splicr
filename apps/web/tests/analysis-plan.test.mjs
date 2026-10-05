import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRows,parseTables} from '../src/lib/intake/tables.ts';
import {applySampleMetadata,suggestComparisons} from '../src/lib/intake/experiment.ts';
import {defaultMle,validateMle,validateDrugz,validateLibrary} from '../src/lib/intake/analysis-plan.ts';
const wide={kind:'counts',layout:'wide',header_row:1,guide_column:'barcode',sample_columns:['vehicle','drug']};
test('explicit identity mapping excludes numeric annotations from counts',()=>{
 const table=parseRows('s',[['barcode','position','vehicle','drug'],['g1',99,10,2]],wide);
 assert.deepEqual(table.sample_columns,['vehicle','drug']);assert.equal(table.mapping.guide_column,'barcode');
});
test('selected counts reject missing measurements and fractional counts',()=>{
 for(const value of ['',1.5,-1]) assert.throws(()=>parseRows('s',[['barcode','vehicle','drug'],['g1',10,value]],wide),/valid|missing|integer/);
});
test('long and transposed layouts preserve the same observations',()=>{
 const long=parseRows('s',[['barcode','Sample','Reads'],['g1','vehicle',10],['g1','drug',2]],{...wide,layout:'long',sample_column:'Sample',count_column:'Reads'});
 const transposed=parseRows('s',[['sample','g1'],['vehicle',10],['drug',2]],{...wide,layout:'transposed'});
 assert.deepEqual(long.preview,transposed.preview);assert.deepEqual(long.sample_columns,['vehicle','drug']);
 assert.throws(()=>parseRows('s',[['barcode','Sample','Reads'],['g1','vehicle',10],['g1','vehicle',2]],{...wide,layout:'long',sample_column:'Sample',count_column:'Reads'}),/Duplicate/);
});
test('long format missing cells are not filled with zero',()=>{
 assert.throws(()=>parseRows('s',[['barcode','Sample','Reads'],['g1','vehicle',10],['g2','drug',2]],{...wide,layout:'long',sample_column:'Sample',count_column:'Reads'}),/valid|missing|integer/);
});
test('explicit library mapping retains negative controls with unfamiliar IDs',()=>{
 const table=parseRows('s',[['barcode','target_name','spacer','class'],['g1','Braf','ACGTACGTACGTACGTACGT','target'],['ctrl-xyz','','TGCATGCATGCATGCATGCA','negative']],{kind:'library',layout:'wide',header_row:1,guide_column:'barcode',gene_column:'target_name',sequence_column:'spacer',control_column:'class',control_value:'negative'});
 assert.equal(table.guides[1].is_control,true);assert.equal(table.guides[0].gene,'Braf');
});
test('unresolved library schemas stay reviewable as context, never used as counts',()=>{
 const table=parseTables(new TextEncoder().encode('ID,Sequence\ng1,ACGTACGTACGTACGTACGT\n'),'library.csv')[0];assert.equal(table.kind,'context');assert.match(table.warnings[0],/gene column/);
});
const table={fileId:'f',name:'count.csv',sheet:'A',model:'A',rows:2,preview:[],warnings:[],samples:[{label:'v1',role:'control',replicate:1},{label:'v2',role:'control',replicate:2},{label:'d1',role:'treatment',replicate:1},{label:'d2',role:'treatment',replicate:2}]};
test('sample sheets preserve arbitrary factors and generic model names',()=>{
 const tables=applySampleMetadata([table],[{Sample:'v1',Model:'OrgX',Batch:'B',timepoint:'14',condition:'vehicle',role:'control',replicate:'1'},{Sample:'d1',Model:'OrgX',Batch:'B',timepoint:'14',dose:'2',condition:'novel compound',role:'treatment',replicate:'1'}]);
 assert.equal(tables[0].samples[0].factors.batch,'B');assert.equal(tables[0].samples[2].factors.dose,'2');
 const contrast=suggestComparisons(tables).find(row=>row.model==='OrgX');assert.deepEqual(contrast.control,['v1']);assert.deepEqual(contrast.treatment,['d1']);
});
test('duplicate, unknown and cross-table ambiguous metadata are blocked',()=>{
 assert.throws(()=>applySampleMetadata([table],[{Sample:'unknown'}]),/not present/);
 assert.throws(()=>applySampleMetadata([table],[{Sample:'v1'},{Sample:'v1'}]),/Duplicate/);
 assert.throws(()=>applySampleMetadata([table,{...table,sheet:'B',model:'B'}],[{Sample:'v1'}]),/multiple tables/);
 const tables=applySampleMetadata([table,{...table,sheet:'B',model:'B'}],[{Sample:'v1',sheet:'B',batch:'changed'}]);assert.equal(tables[0].samples[0].factors,undefined);assert.equal(tables[1].samples[0].factors.batch,'changed');
});
test('different doses and times do not get silently pooled into a contrast',()=>{
 const t={...table,samples:table.samples.map(s=>({...s,factors:{model:'A',condition:s.role==='control'?'vehicle':'drug',timepoint:s.label.endsWith('1')?'7':'14',dose:s.role==='treatment'?'2':'0'}}))};
 const comparisons=suggestComparisons([t]);assert.equal(comparisons.length,2);assert.deepEqual(comparisons.map(c=>c.control),[['v1'],['v2']]);
});
test('MLE validates selected coefficient, residual degrees of freedom and confounding',()=>{
 const design=defaultMle(table.samples,['d1','d2'],['v1','v2']);assert.equal(validateMle(design,['d1','d2','v1','v2']),null);
 assert.match(validateMle({...design,columns:['baseline','treatment','confounded'],rows:design.rows.map(r=>({...r,values:[...r.values,r.values[1]]}))},['v1','v2','d1','d2']),/confounded/);
 assert.match(validateMle({...design,coefficient:'baseline'},['v1','v2','d1','d2']),/other than/);
 assert.match(validateMle({...design,rows:design.rows.slice(0,2)},['v1','v2']),/more samples/);
});
test('unsupported profiles and ineffective parameter ranges are rejected',()=>{
 assert.equal(validateDrugz({pseudocount:5,half_window_size:500}),null);assert.match(validateDrugz({pseudocount:0,half_window_size:500}),/pseudocount/);
 assert.equal(validateLibrary({organism_taxid:10090,modality:'crispri',cas:'dCas9'}),null);assert.match(validateLibrary({organism_taxid:9606,modality:'base_edit',cas:'SpCas9'}),/knockout/);
});
