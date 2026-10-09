from types import SimpleNamespace
import hashlib
import json
import numpy as np
import pytest
from scipy.stats import t
from splicr.count import CountMatrix
from splicr.references import Guide, Library
from splicr.lab_evidence import receipt, validate_options, kinetics, drift, isoform_report, build_evidence
from splicr.lab_context import summarize_context
from splicr.validate import isoform


def fixture(reps=1):
    samples = [f'r{r}d{d}' for r in range(reps) for d in (0, 1, 2)]
    guides = [Guide(f'n{i}', 'A'*20, None, True) for i in range(10)] + [Guide('a', 'C'*20, 'GENE'), Guide('b', 'G'*20, 'GENE')]
    library = Library('fixture', 'fixture', guides)
    controls = [[100] * len(samples) for _ in range(10)]
    row = [v for r in range(reps) for v in ([100, 50, 25] if r == 0 else [100, 75, 50])]
    matrix = CountMatrix('fixture', [g.guide_id for g in guides], [g.gene for g in guides], samples, controls + [row.copy(), row.copy()])
    options = {'kinetic_normalization': 'control', 'time_course': [{'sample': f'r{r}d{d}', 'day': d, 'condition': 'drug', 'replicate': str(r)} for r in range(reps) for d in (0, 1, 2)]}
    return matrix, library, options


def test_kinetic_slope_matches_independent_closed_form():
    matrix, library, options = fixture()
    result = kinetics(matrix, library, options)['GENE']
    expected = np.log2(26/101)/2
    assert result['conditions'][0]['slope'] == pytest.approx(expected)
    assert result['conditions'][0]['ci95'] is None
    assert result['conditions'][0]['n_replicates'] == 1
    assert result['n_guides'] == 2
    assert result['trajectories'][0]['guides'][0]['counts'] == [100, 50, 25]


def test_ci_uses_trajectories_not_number_of_guides():
    matrix, library, options = fixture(2)
    result = kinetics(matrix, library, options)['GENE']['conditions'][0]
    slopes = [np.log2(26/101)/2, np.log2(51/101)/2]
    mean = np.mean(slopes)
    se = np.std(slopes, ddof=1)/np.sqrt(2)
    assert result['standard_error'] == pytest.approx(se)
    assert result['ci95'] == pytest.approx([mean - t.ppf(.975, 1)*se, mean + t.ppf(.975, 1)*se])


def test_irregular_days_used_as_numeric_elapsed_time():
    matrix, library, options = fixture()
    for p, d in zip(options['time_course'], [7, 9, 14]): p['day'] = d
    result = kinetics(matrix, library, options)['GENE']['conditions'][0]
    x = np.array([7., 9., 14.]); y = np.log2(np.array([101., 51., 26.])/101)
    assert result['slope'] == pytest.approx(np.sum((x-x.mean())*(y-y.mean()))/np.sum((x-x.mean())**2))


def test_unselected_samples_do_not_change_normalization():
    matrix, library, options = fixture()
    original = kinetics(matrix, library, options)
    matrix.samples.append('excluded')
    for row in matrix.matrix: row.append(1000000)
    assert kinetics(matrix, library, options) == original


@pytest.mark.parametrize('mutation', ['duplicate_sample', 'duplicate_day', 'negative_day', 'two_times', 'missing_sample', 'nan', 'bool_day', 'unnamed_condition'])
def test_invalid_time_design_is_rejected(mutation):
    matrix, _, options = fixture()
    if mutation == 'duplicate_sample': options['time_course'][1]['sample'] = matrix.samples[0]
    if mutation == 'duplicate_day': options['time_course'][1]['day'] = 0
    if mutation == 'negative_day': options['time_course'][1]['day'] = -1
    if mutation == 'two_times': options['time_course'].pop()
    if mutation == 'missing_sample': options['time_course'][1]['sample'] = 'missing'
    if mutation == 'nan': options['time_course'][1]['day'] = float('nan')
    if mutation == 'bool_day': options['time_course'][1]['day'] = True
    if mutation == 'unnamed_condition': options['time_course'][1]['condition'] = ' '
    with pytest.raises(ValueError): validate_options(options, matrix.samples)


def test_no_negative_control_scale_is_not_imputed():
    matrix, library, options = fixture()
    for g in library.guides: g.is_control = False
    with pytest.raises(ValueError, match='ten measured'): kinetics(matrix, library, options)


def test_all_zero_counts_have_null_gini_and_no_fake_lorenz():
    matrix = CountMatrix('fixture', ['a','b'], ['A','B'], ['empty'], [[0],[0]])
    result = drift(matrix, Library('fixture','fixture',[]), [], {})
    assert result['samples'][0]['raw_count_gini'] is None
    assert result['samples'][0]['lorenz'] == []
    assert result['negative_controls']['status'] == 'insufficient_controls'
    json.dumps(result, allow_nan=False)


def test_lorenz_and_raw_gini_match_known_distribution():
    matrix = CountMatrix('fixture', ['a','b'], ['A','B'], ['pool'], [[0],[10]])
    result = drift(matrix, Library('fixture','fixture',[]), [], {'pool':'plasmid'})
    assert result['samples'][0]['raw_count_gini'] == pytest.approx(.5)
    assert result['samples'][0]['lorenz'] == [[0.,0.],[.5,0.],[1.,1.]]
    assert result['samples'][0]['baseline'] is True


@pytest.fixture
def exon_index(monkeypatch):
    idx = {'spans': {'GENE': (0,4)}, 'chrom': np.array(['chr1']*4), 'tcode': np.array([0,0,1,1]),
           'start': np.array([10,12,30,32]), 'end': np.array([20,18,40,38]),
           'is_cds': np.array([False,True,False,True]), 'tname': np.array(['T1','T2']),
           'strand': np.array(['-']*4), 'exon_number': np.array([2,2,1,1])}
    monkeypatch.setattr(isoform, '_index', lambda: idx)
    return idx


def test_zero_based_half_open_boundaries_and_reverse_strand(exon_index):
    assert isoform.inclusion('GENE','1',12).coding_fraction == .5
    assert isoform.inclusion('GENE','chr1',18).coding_fraction == 0
    assert isoform.inclusion('GENE','chr1',20).exonic_fraction == 0
    assert isoform.transcript_tracks('GENE')[0]['strand'] == '-'
    assert isoform.transcript_tracks('GENE')[0]['exons'][0]['number'] == 2


def test_missing_expression_is_not_zero(exon_index):
    with pytest.raises(ValueError, match='incomplete'): isoform.inclusion('GENE','chr1',15, {'T1': 100})
    assert isoform.inclusion('GENE','chr1',15, {'T1': 100, 'T2': 0}).coding_fraction == 1


@pytest.mark.parametrize('expression', [{'T1':float('nan'),'T2':1}, {'T1':-1,'T2':2}, {'T1':float('inf'),'T2':0}])
def test_invalid_transcript_expression_refused(exon_index, expression):
    with pytest.raises(ValueError): isoform.inclusion('GENE','chr1',15, expression)


def test_zero_expression_distinct_from_exon_exclusion(exon_index):
    result = isoform.inclusion('GENE','chr1',15, {'T1':0,'T2':0})
    assert not result.evaded
    assert 'not expressed' in result.note
    guide = SimpleNamespace(guide_key='a',log2_fold_change=-1.,chromosome='chr1',cut_position=15,strand='+')
    report = isoform_report('GENE',[guide], {'T1':0,'T2':0}, 'measured fixture')
    assert report['guides'][0]['expression']['status'] == 'not_expressed'
    assert report['guides'][0]['expression']['coding_fraction'] is None
    json.dumps(report, allow_nan=False)


def test_reference_missing_values_are_not_global_fallbacks_or_denominator_zeros():
    resource = SimpleNamespace(release='24Q4', _gene_pos={'GENE':0}, _model_pos={'A':0}, models=['A','B','C'],
        lineage_of={'A':'L'}, _lineage_rows={'L':np.array([0,1,2])}, effect=np.array([[-1.], [np.nan], [0.]]),
        copy_number=None, _cn_model_pos={})
    result = summarize_context(resource,'GENE','A','user_declared_model')
    assert result['exact']['effect'] == -1
    assert result['global_reference']['n_measured_models'] == 2
    assert result['global_reference']['fraction_effect_le_minus_0_5'] == .5
    assert result['lineage_reference']['n_measured_models'] == 1
    assert result['lineage_reference']['mean_effect'] == 0
    missing = summarize_context(resource,'GENE','missing','unmatched')
    assert missing['exact']['effect'] is None
    assert missing['global_reference']['median_effect'] == -.5
    unknown_gene = summarize_context(resource,'ABSENT','A','user_declared_model')
    assert unknown_gene['status'] == 'not_measured'
    assert unknown_gene['global_reference']['mean_effect'] is None


def test_canonical_receipt_is_deterministic_and_changes_with_input():
    a = receipt('context','GENE', {'status':'measured','value':0}, {'counts_sha256':'a'})
    b = receipt('context','GENE', {'value':0,'status':'measured'}, {'counts_sha256':'a'})
    assert a['sha256'] == b['sha256']
    assert hashlib.sha256(a['canonical'].encode()).hexdigest() == a['sha256']
    assert a['sha256'] != receipt('context','GENE', {'status':'measured','value':0}, {'counts_sha256':'b'})['sha256']


def test_no_ai_modules_create_portable_real_receipts(tmp_path):
    matrix, library, options = fixture()
    spec = SimpleNamespace(lab_evidence=options,roles={},cell_line=None,model_id=None,modality='knockout')
    results = build_evidence(matrix, library, SimpleNamespace(guide_effects=[],genes={'GENE':None}), spec, tmp_path)
    assert {r['kind'] for r in results} == {'drift','kinetics'}
    portable = json.loads((tmp_path/'lab_evidence.json').read_text())
    assert portable['records'] == results
    assert len(results) == 2


def test_time_course_qc_pairs_only_matching_condition_and_day():
    from splicr.qc import screen_qc
    matrix, library, options = fixture(2)
    factors = {p['sample']:(p['condition'],p['day']) for p in options['time_course']}
    qc = screen_qc(matrix,{s:'treatment' for s in matrix.samples},matrix.samples,[],library,
                   assess_essentiality=False,sample_factors=factors)
    assert len(qc.replicate_pairs) == 3
    assert all(factors[p.a] == factors[p.b] for p in qc.replicate_pairs)
    single, library, options = fixture(1)
    qc = screen_qc(single,{s:'treatment' for s in single.samples},single.samples,[],library,
                   assess_essentiality=False,sample_factors={p['sample']:(p['condition'],p['day']) for p in options['time_course']})
    assert qc.replicate_pairs == []


def test_baseline_concentration_flag_is_observation_not_contamination_diagnosis():
    matrix, library, _ = fixture()
    for row in matrix.matrix: row[0] = 0
    matrix.matrix[0][0] = 1000
    result = drift(matrix,library,[],{matrix.samples[0]:'reference'})
    flag = result['flags'][0]
    assert flag['severity'] == 'critical_review'
    assert flag['value'] == 1
    assert flag['threshold'] == .9
    assert 'does not identify its cause' in flag['message']


def test_expression_file_rejects_duplicate_json_and_gzip_blanks(tmp_path):
    from splicr.lab_evidence import read_expression_file
    import gzip
    source = tmp_path/'expression.json'
    source.write_text('{"ENST1":0,"ENST1":2}')
    with pytest.raises(ValueError,match='duplicate'): read_expression_file(source)
    source.write_text('{"ENST1":0,"ENST2":4}')
    assert read_expression_file(source) == {'ENST1':0,'ENST2':4}
    source = tmp_path/'expression.tsv.gz'
    with gzip.open(source,'wt') as out: out.write('transcript_id\tTPM\nENST1\t\n')
    with pytest.raises(ValueError,match='explicit'): read_expression_file(source)


def test_exact_mapping_verifies_plus_minus_pam_and_marks_reporting_cap(monkeypatch,tmp_path):
    from splicr import guide_mapping
    from splicr.validate.genome import Genome, revcomp
    plus='ACGTACGTCAGTACGTCAGT'; minus='TGCATGCATCGATGCATCGA'; bad='GTCAAGTCAAGTCAAGTCAA'
    dna='T'*50+plus+'AGG'+'T'*50+'CCA'+revcomp(minus)+'T'*50+bad+'AAA'+'T'*50
    fasta=tmp_path/'hg38.fa'; fasta.write_text('>chr1\n'+dna+'\n')
    fasta.with_suffix('.fa.fai').write_text(f'chr1\t{len(dna)}\t6\t{len(dna)}\t{len(dna)+1}\n')
    for i in range(6): (tmp_path/f'hg38.{i}.ebwt').write_text('test index identity')
    program=tmp_path/'bowtie'; program.write_text('fixture executable')
    monkeypatch.setattr(guide_mapping,'_bowtie',lambda:str(program))
    monkeypatch.setattr(guide_mapping,'REFERENCE_DIR',tmp_path)
    def align(command,**kwargs):
        sequences=Path(command[-2]).read_text().splitlines()
        ids={sequences[i+1]:sequences[i][1:] for i in range(0,len(sequences),2)}
        # Reporting limit intentionally reached for plus guide.
        Path(command[-1]).write_text((f"{ids[plus]}\t+\tchr1\t50\n"*100)+
           f"{ids[minus]}\t-\tchr1\t{dna.index(revcomp(minus))}\n"+
           f"{ids[bad]}\t+\tchr1\t{dna.index(bad)}\n")
    from pathlib import Path
    monkeypatch.setattr(guide_mapping.subprocess,'run',align)
    genome=Genome(fasta)
    try:
        mapping,reason=guide_mapping._align(genome,[Guide('a',plus,'A'),Guide('b',minus,'B'),Guide('c',bad,'C')],{'genome_sha256':guide_mapping.file_identity(fasta)})
        assert reason is None
        assert mapping[plus]['capped'] is True
        assert mapping[plus]['sites'] == [['chr1',67,'+','AGG']]
        assert mapping[minus]['sites'] == [['chr1',dna.index(revcomp(minus))+3,'-','TGG']]
        assert mapping[bad]['sites'] == []
    finally: genome.close()


def test_ambiguous_mapping_does_not_guess_a_gene_target(monkeypatch,tmp_path):
    from splicr import guide_mapping
    class Genome:
        path=tmp_path/'fixture.fa'
        def close(self): pass
    monkeypatch.setattr(guide_mapping,'Genome',Genome)
    sequence='ACGT'*5
    result={'sites':[['chr1',20,'+','AGG'],['chr2',80,'+','AGG']],'capped':False}
    monkeypatch.setattr(guide_mapping,'_align',lambda *args:({sequence:result},None))
    library=Library('custom','custom',[Guide('g',sequence,'GENE')],learned=True)
    mapped,notes=guide_mapping.verified_library_coordinates(library)
    assert mapped.guides[0].cut_pos is None
    assert 'Multiple exact NGG loci' in notes['g']['reason']
    assert mapped.learned is True


def test_all_zero_trajectory_is_not_independent_evidence_of_no_effect():
    matrix,library,options=fixture(2)
    for row in matrix.matrix[10:]: row[3:]=[0,0,0]
    result=kinetics(matrix,library,options)['GENE']
    assert len(result['trajectories']) == 1
    assert result['conditions'][0]['n_replicates'] == 1
    assert result['conditions'][0]['ci95'] is None
    assert len(result['unmeasured_trajectories']) == 1
    assert result['unmeasured_trajectories'][0]['replicate'] == '1'
