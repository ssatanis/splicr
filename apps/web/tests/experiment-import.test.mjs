import assert from 'node:assert/strict';
import test from 'node:test';
import {parseRows,suggestGuideAliases} from '../src/lib/intake/tables.ts';
import {tableSamples,suggestComparisons} from '../src/lib/intake/experiment.ts';

test('supplement title rows and a blank guide header produce samples, not title columns',()=>{
 const table=parseRows('Model A',[['Supplementary Table 6'],['','D4_rep1','D39_DMSO_rep1','D39_GEF_rep1'],['AAK1_PKc_E5_1',100,40,20],['BRAF_PKc_E3_2',20,30,50],['',120,70,70]]);
 assert.equal(table.kind,'counts');assert.equal(table.header_row,2);assert.equal(table.rows_seen,2);assert.equal(table.warnings.length,1);
 const samples=tableSamples(table.sample_columns);
 assert.equal(samples[0].role,'reference');
 const comparisons=suggestComparisons([{fileId:'f',sheet:'s',name:'s',model:'A',samples,rows:2,preview:[],warnings:[]}]);
 assert.equal(comparisons.length,2);assert.deepEqual(comparisons[1].control,['D39_DMSO_rep1']);assert.deepEqual(comparisons[1].treatment,['D39_GEF_rep1']);
});

test('replicate separators and models stay distinct',()=>{
 const samples=tableSamples(['D3_Rep_1','D3_Rep_2','D3_Rep_3','D31_DMSO_1','D31_DMSO_2','D31_DMSO_3','D31_GEF_1','D31_GEF_2','D31_GEF_3','D31_TRM_1','D31_TRM_2','D31_TRM_3']);
 assert.deepEqual(samples.map(s=>s.replicate),[1,2,3,1,2,3,1,2,3,1,2,3]);
 const plans=suggestComparisons(['002','007'].map(model=>({fileId:'f',sheet:model,name:'s',model,samples,rows:2,preview:[],warnings:[]})));
 assert.equal(plans.length,6);assert.equal(plans.filter(c=>c.drug).length,4);assert.equal(plans[0].table,0);assert.equal(plans[3].table,1);
});

test('a gene-level published hit table is supporting evidence, not guide counts',()=>{
 assert.equal(parseRows('Validation',[['gene','lfc','fdr'],['A',-3,.01],['B',1,.1]]).kind,'context');
});

test('duplicate source guide IDs retain their separate sequences',()=>{
 const table=parseRows('Library',[['ID','sgRNA'],['AAK1_PKc_E2_1','ACGTACGTACGTACGTACGT'],['AAK1_PKc_E2_1','TGCATGCATGCATGCATGCA'],['neg01','GATCGATCGATCGATCGATC']]);
 assert.equal(table.guides.length,3);assert.deepEqual(table.guides.map(g=>g.guide_id),['AAK1_PKc_E2_1__sequence_1','AAK1_PKc_E2_1__sequence_2','neg01']);assert.equal(table.guides[2].is_control,true);
});

test('library target inference refuses unstructured unknown IDs',()=>{
 assert.throws(()=>parseRows('Library',[['ID','Sequence'],['guide1','ACGTACGTACGTACGTACGT']]),/needs a gene column/);
});

test('alias proposals are narrow and ambiguous candidates remain unassigned',()=>{
 const guides=['RPL9_e4.1','ABCD_e1','ABDC_e1'].map(guide_id=>({guide_id,sequence:'ACGTACGTACGTACGTACGT',gene:'X',is_control:false}));
 assert.deepEqual(suggestGuideAliases(['PRL9_e4.1','ABCD_e1','ZZZZ_e1'],guides),[{source:'PRL9_e4.1',target:'RPL9_e4.1'},{source:'ZZZZ_e1',target:''}]);
});

test('JSON tables support records and explicit rows without inventing columns',async()=>{
 const {parseTables}=await import('../src/lib/intake/tables.ts');
 const records=[{Guide:'A',Gene:'AAK1',T0:20,Treated:3},{Guide:'B',Gene:'BRAF',T0:10,Treated:4}];
 const tables=parseTables(new TextEncoder().encode(JSON.stringify(records)),'screen.json');
 assert.equal(tables[0].kind,'counts');assert.deepEqual(tables[0].sample_columns,['T0','Treated']);
 assert.equal(parseTables(new TextEncoder().encode('{"metadata":{"gene":"AAK1"}}'),'context.json')[0].kind,'context');
});

test('FASTQ lanes merge one guide-bearing mate and preserve biological replicate labels',async()=>{
 const {deriveSamples}=await import('../src/lib/intake/derive.ts');
 const samples=deriveSamples([],['DMSO_rep1_S1_L001_R1_001.fastq.gz','DMSO_rep1_S1_L002_R1_001.fastq.gz','DMSO_rep1_S1_L001_R2_001.fastq.gz','DMSO_rep_2.fastq.gz'].map((name,i)=>({name,fileId:String(i)})));
 assert.equal(samples.length,2);assert.deepEqual(samples[0].file_ids,['0','1']);assert.deepEqual(samples[0].read2_file_ids,['2']);assert.equal(samples[1].replicate,2);
 assert.equal(deriveSamples([],['ModelA/ctrl_R1.fastq','ModelB/ctrl_R1.fastq'].map((name,i)=>({name,fileId:String(i)}))).length,2);
});
