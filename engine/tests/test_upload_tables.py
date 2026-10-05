from pathlib import Path
import pytest
from splicr.references import Guide,Library
from splicr.upload_tables import canonical_counts
from splicr.count import read_count_table

@pytest.fixture
def library():
    return Library('custom','Custom',[Guide('A','ACGT','AAK1'),Guide('B__sequence_1','ACGA','BRAF'),Guide('B__sequence_2','ACGG','BRAF')])

def test_reordered_columns_and_confirmed_aliases(tmp_path,library):
    source=tmp_path/'counts.csv';source.write_text('Guide,Treated,Unused,T0\nTypo,3,999,20\nB,4,999,10\n')
    dest=canonical_counts(source,library,['T0','Treated'],tmp_path/'out.tsv',aliases={'Typo':'A'})
    matrix=read_count_table(dest,library)
    assert matrix.samples==['T0','Treated'];assert matrix.guide_ids==['A','B'];assert matrix.genes==['AAK1','BRAF'];assert matrix.matrix==[[20,3],[10,4]]

def test_unconfirmed_aliases_fail(tmp_path,library):
    source=tmp_path/'counts.tsv';source.write_text('Guide\tT0\tTreated\nTypo\t20\t3\n')
    with pytest.raises(ValueError,match='no unambiguous match'):canonical_counts(source,library,['T0','Treated'],tmp_path/'out.tsv')

@pytest.mark.parametrize('bad',['','-1','NaN','1.5'])
def test_missing_or_invalid_counts_are_not_zero(tmp_path,library,bad):
    source=tmp_path/'counts.tsv';source.write_text(f'Guide\tT0\tTreated\nA\t20\t{bad}\n')
    with pytest.raises(ValueError,match='nonnegative integer'):canonical_counts(source,library,['T0','Treated'],tmp_path/'out.tsv')

def test_verified_footer_is_removed_but_malformed_footer_fails(tmp_path,library):
    source=tmp_path/'counts.tsv';source.write_text('Guide\tT0\tTreated\nA\t20\t3\n\t20\t3\n')
    dest=canonical_counts(source,library,['T0','Treated'],tmp_path/'out.tsv');assert len(read_count_table(dest).guide_ids)==1
    source.write_text('Guide\tT0\tTreated\nA\t20\t3\n\t21\t3\n')
    with pytest.raises(ValueError):canonical_counts(source,library,['T0','Treated'],tmp_path/'out.tsv')

@pytest.mark.parametrize('extension',['xls','ods'])
def test_legacy_workbook_engines_preserve_counts(tmp_path,library,extension):
    source=Path(__file__).parent/'fixtures'/'upload-tables'/f'counts.{extension}'
    dest=canonical_counts(source,library,['T0','Treated'],tmp_path/'out.tsv',sheet='Counts')
    matrix=read_count_table(dest,library)
    assert matrix.matrix==[[20,3],[10,4]]

@pytest.mark.parametrize('layout',['records','rows','columns'])
def test_json_table_layouts_preserve_observed_counts(tmp_path,library,layout):
    import json
    body=[['Guide','T0','Treated'],['A',20,3],['B',10,4]]
    value=body if layout=='rows' else {'columns':body[0],'data':body[1:]} if layout=='columns' else [dict(zip(body[0],row)) for row in body[1:]]
    source=tmp_path/'counts.json';source.write_text(json.dumps(value))
    dest=canonical_counts(source,library,['T0','Treated'],tmp_path/'out.tsv')
    assert read_count_table(dest,library).matrix==[[20,3],[10,4]]

def test_retry_count_write_replaces_its_run_and_preserves_observed_zeros():
    from contextlib import contextmanager
    from splicr.db import RunContext,write_guide_counts
    from splicr.count import CountMatrix
    class Connection:
        def __init__(self):self.calls=[];self.rows=[]
        def execute(self,sql,params):self.calls.append((sql,params))
        def cursor(self):return self
        @contextmanager
        def copy(self,sql):yield self
        def write_row(self,row):self.rows.append(row)
    conn=Connection();ctx=RunContext('org','screen','run','comparison')
    matrix=CountMatrix('custom',['A','B'],['AAK1','BRAF'],['T0','Treated'],[[0,0],[20,3]])
    assert write_guide_counts(conn,ctx,matrix,{'T0':'t0','Treated':'treated'})==4
    assert conn.calls[0][1]==('screen','run')
    assert [row[-1] for row in conn.rows]==[0,0,20,3]

@pytest.mark.parametrize('layout',['wide','long','transposed'])
def test_reviewed_layout_is_identical_to_worker_counts(tmp_path,library,layout):
    bodies={'wide':'barcode,position,vehicle,drug\nA,99,20,3\nB,50,10,4\n','long':'barcode,sample,reads\nA,vehicle,20\nA,drug,3\nB,vehicle,10\nB,drug,4\n','transposed':'sample,A,B\nvehicle,20,10\ndrug,3,4\n'}
    mapping={'kind':'counts','layout':layout,'header_row':1,'guide_column':'barcode','sample_columns':['vehicle','drug'],'sample_column':'sample','count_column':'reads'}
    source=tmp_path/'screen.csv';source.write_text(bodies[layout])
    path=canonical_counts(source,library,['vehicle','drug'],tmp_path/'out.tsv',mapping=mapping)
    assert read_count_table(path,library).matrix==[[20,3],[10,4]]

def test_long_missing_measurement_stays_missing(tmp_path,library):
    source=tmp_path/'screen.csv';source.write_text('barcode,sample,reads\nA,vehicle,20\nB,drug,3\n')
    mapping={'kind':'counts','layout':'long','header_row':1,'guide_column':'barcode','sample_column':'sample','count_column':'reads'}
    with pytest.raises(ValueError,match='missing is not zero'):
        canonical_counts(source,library,['vehicle','drug'],tmp_path/'out.tsv',mapping=mapping)

def test_mle_rejects_confounding_and_selects_explicit_coefficient():
    from splicr.analysis_plan import validate_mle
    design={'columns':['baseline','treatment','batch'],'coefficient':'treatment','permutation_round':25,'rows':[{'sample':f's{i}','values':[1,i%2,i//2]} for i in range(4)]}
    validate_mle(design,[f's{i}' for i in range(4)])
    design['rows']=[{'sample':f's{i}','values':[1,i%2,i%2]} for i in range(4)]
    with pytest.raises(ValueError,match='confounded'):validate_mle(design,[f's{i}' for i in range(4)])
