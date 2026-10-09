"""Build the shareable PDF from measured pipeline outputs only."""
import csv
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.graphics.shapes import Drawing, Rect, Line, String

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output'
DEST=Path('/Users/sahaj/Documents/Projects/SplicR/output/pdf')
DEST.mkdir(parents=True,exist_ok=True)
pdf=DEST/'SplicR-Millman-screen-analysis.pdf'
summary=json.loads((OUT/'results_summary.json').read_text())
timing=json.loads((OUT/'timing.json').read_text())
audit=json.loads((OUT/'input_audit.json').read_text())
report=json.loads((OUT/'splicr/postscreen_report.json').read_text())
qc={s['label']:s for s in report['qc']['samples']}
navy=colors.HexColor('#142C48');blue=colors.HexColor('#2165B0');teal=colors.HexColor('#147D83')
light=colors.HexColor('#EDF3F8');ink=colors.HexColor('#243343');muted=colors.HexColor('#586A7B')
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleCustom',fontName='Helvetica-Bold',fontSize=23,leading=27,textColor=navy,spaceAfter=10))
styles.add(ParagraphStyle(name='Sub',fontName='Helvetica',fontSize=10,leading=14,textColor=muted,spaceAfter=12))
styles.add(ParagraphStyle(name='Section',fontName='Helvetica-Bold',fontSize=13,leading=17,textColor=navy,spaceBefore=13,spaceAfter=7))
styles.add(ParagraphStyle(name='BodyCustom',fontName='Helvetica',fontSize=9.4,leading=12.5,textColor=ink,spaceAfter=6))
styles.add(ParagraphStyle(name='SmallCustom',fontName='Helvetica',fontSize=8.4,leading=11.7,textColor=muted,spaceAfter=5))
styles.add(ParagraphStyle(name='Cell',fontName='Helvetica',fontSize=9,leading=12,textColor=ink))
styles.add(ParagraphStyle(name='CellHead',fontName='Helvetica-Bold',fontSize=8.5,leading=11,textColor=colors.white))
story=[]
def para(s,style='BodyCustom'):return Paragraph(s,styles[style])
def add(s,style='BodyCustom'):story.append(para(s,style))
def table(headers,rows,widths):
    data=[[para(x,'CellHead') for x in headers]]+[[para(str(x),'Cell') for x in row] for row in rows]
    t=Table(data,colWidths=widths,hAlign='LEFT',repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,light]),
        ('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),
        ('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),
        ('LINEBELOW',(0,-1),(-1,-1),0.5,colors.HexColor('#D0DAE4'))]))
    story.append(t)

add('SplicR | Published screen analysis','Sub')
add('Millman lab CRISPRa<br/>islet transplantation screen','TitleCustom')
add('Source: Maestas et al., Stem Cells Translational Medicine (2026), DOI 10.1093/stcltm/szag012.<br/>Analysis prepared October 8, 2026. Published count tables; local SplicR engine.','Sub')
table(['Main SplicR run','Published top 20 recovered','Standalone MAGeCK agreement'],
      [[f"{timing['splicr_pipeline_seconds']:.1f} seconds",'20 of 20 genes','Exact, all numeric gene columns']],[166,166,184])
add('What was analyzed','Section')
add('All 106,400 published guide IDs and their supplied sequences were imported from the <b>Whole-genome screen</b> sheet in Source_Data.xlsx. The primary contrast was the day-10 kidney graft endpoint against differentiated D0, using MAGeCK RRA and median normalization. The workbook contains two aggregate count columns, not individual mouse replicates.')
add('Guide representation in the released table','Section')
table(['Sample','Count sum','Detected / 106,400','Mean count / guide','90th / 10th percentile'],
      [[s,f"{audit['samples'][s]['total_counts']:,}",f"{audit['samples'][s]['detected_guides']:,} (99.96%)",f"{audit['samples'][s]['mean_counts']:.1f}",f"{qc[s]['skew_ratio']:.2f}"] for s in ['D0','kidney']],
      [62,100,141,107,106])
add('Each column has 42 zero-count guides, including 37 zero in both columns. Five guides detectable at D0 are zero at the endpoint; five show the reverse pattern. This describes aggregate sequencing representation. It cannot establish cell coverage or exclude a bottleneck in an individual graft.','SmallCustom')
add('The nominated genes remain high in the enrichment ranking','Section')
table(['Gene','Rank','MAGeCK gene log2 FC','Guides with positive log2 FC','Largest absolute guide effect share'],
      [[g,summary['key_genes'][g]['enrichment_rank'],f"{float(summary['key_genes'][g]['median_log2_fold_change']):+.3f}",f"{summary['key_genes'][g]['guides_with_positive_LFC']} / 5",f"{float(summary['key_genes'][g]['max_absolute_guide_effect_share']):.0%}"] for g in ['SIX3','FCAMR','GSTM3','HSF2']],
      [66,45,117,134,154])
add('<b>Statistical interpretation:</b> These are ranked candidates. No target gene passed 10% native directional FDR in either normalization run. The four genes above have native enrichment FDR 0.909 in the median-normalized run; their RRA scores are not FDR values. The paper nominated the top 1% and performed separate functional follow-up. This analysis does not invalidate that follow-up.','SmallCustom')

story.append(PageBreak())
add('Evidence behind a gene rank','TitleCustom')
add('The added SplicR analysis makes guide support and review flags visible alongside the unchanged MAGeCK statistics.','Sub')
def plot():
    d=Drawing(516,255)
    guide_rows=list(csv.DictReader((OUT/'key_gene_guide_results.csv').open()))
    by_gene={g:sorted([r for r in guide_rows if r['Gene']==g],key=lambda r:r['sgrna']) for g in ['SIX3','FCAMR','GSTM3','HSF2']}
    for n,g in enumerate(['SIX3','FCAMR','GSTM3','HSF2']):
        left=(n%2)*267; top=240-(n//2)*127
        x0=left+42; w=186; xmin=-.5; xmax=4.7
        def x(v):return x0+(v-xmin)/(xmax-xmin)*w
        d.add(String(left,top,g,fontName='Helvetica-Bold',fontSize=11,fillColor=navy))
        for tick in [0,1,2,3,4]:
            d.add(Line(x(tick),top-96,x(tick),top-16,strokeColor=colors.HexColor('#DEE6EE'),strokeWidth=.6))
            d.add(String(x(tick)-2,top-107,str(tick),fontSize=8,fillColor=muted))
        for i,r in enumerate(by_gene[g]):
            v=float(r['LFC']);y=top-27-i*15
            d.add(String(left,y+2,f"g{i+1}",fontSize=8.5,fillColor=muted))
            d.add(Rect(min(x(0),x(v)),y,max(abs(x(v)-x(0)),.7),10,fillColor=blue if v>0 else colors.HexColor('#B76058'),strokeColor=None))
            labelx=x(v)+4 if v>=0 else x(0)+4
            d.add(String(labelx,y+1,f"{v:+.2f}",fontSize=8,fillColor=ink))
    return d
story.append(plot())
add('MAGeCK per-guide log2 fold changes, kidney versus D0; identical horizontal scale in all panels. g1-g5 follow the supplied guide suffix order. Full guide IDs, normalized counts and statistics are included in the CSV outputs.','SmallCustom')
add('A concrete follow-up review signal','Section')
add('<b>HSF2 is enrichment rank 2</b>, but only two of its five guides have positive log2 fold changes. Guide 3 has log2 FC +4.41; the gene median is -0.049. That guide accounts for 89.2% of the sum of absolute guide log2 fold changes. The SplicR single-guide rule flags it for review because the share exceeds 60%. This is a support flag, not proof that the gene is a false positive.')
add('<b>FCAMR and GSTM3</b> each have four of five guides with positive log2 fold changes, with maximum absolute guide shares of 35.9% and 28.0%. SIX3 has five of five positive guides. None of these three receives the single-guide or disagreement flag.')
add('Across the exploratory top 1% (190 genes), <b>41 candidates</b> have a single-guide concentration or minority-direction flag. Both types retain the original counts, statistics and the rule that triggered the flag, so the shortlist can be reviewed before ordering follow-up experiments.')
add('Check against the 3,755 non-targeting controls','Section')
table(['Gene','Median normalization: rank / log2 FC','Control normalization: rank / log2 FC'],
      [[g,f"{summary['key_genes'][g]['enrichment_rank']} / {float(summary['key_genes'][g]['median_log2_fold_change']):+.3f}",
        f"{summary['key_genes'][g]['control_normalization_enrichment_rank']} / {float(summary['key_genes'][g]['control_normalization_log2_fold_change']):+.3f}"] for g in ['SIX3','FCAMR','GSTM3']], [78,219,219])

story.append(PageBreak())
add('Reproducibility and scope','TitleCustom')
add('Measured computation, preserved settings, and clear limits for an in vivo CRISPRa screen.','Sub')
add('Independent MAGeCK comparison','Section')
add('A separate standalone MAGeCK 0.5.9.5 invocation used the same count matrix, kidney-versus-D0 contrast and median normalization. All 13 numeric gene-summary columns matched exactly across 18,914 rows, including the control group. SplicR reports 18,913 target gene labels after excluding CONTROL. This verifies preservation of MAGeCK outputs, not superiority in biological accuracy.')
add('The publication supplies 18,725 gene RRA scores. The new run recovers the same 20 genes in its top 20, with ranking differences; SIX3 remains rank 1. Exact agreement with the authors\' original numerical output is not claimed because the original version and full command settings were not released. The paper states 18,915 library targets; the supplied workbook contains 18,913 distinct non-control gene labels.')
add('Measured runtime on Apple M4','Section')
table(['Timed phase','Seconds'],[
    ['Workbook validation, study guide map and count-table conversion',f"{timing['input_conversion_and_audit_seconds']:.2f}"],
    ['Main SplicR count-table pipeline',f"{timing['splicr_pipeline_seconds']:.2f}"],
    ['Standalone MAGeCK reproducibility check',f"{summary['independent_mageck']['standalone_runtime_seconds']:.2f}"],
    ['SplicR control-normalization sensitivity run',f"{summary['control_normalization_pipeline_seconds']:.2f}"],
    ['Total timed computation, including checks and CSV exports',f"{timing['input_to_report_seconds']+summary['verification_and_export_seconds']:.2f}"]],[408,108])
add('The total sums two measured execution phases; it is not elapsed time for the entire research task. Timings exclude source download, dependency setup, reading the paper, PDF creation and correspondence. These are local count-table runs, not FASTQ-to-result timings or a hardware-matched speed claim. The main SplicR run includes its underlying MAGeCK call.','SmallCustom')
add('What this input can and cannot establish','Section')
add('The guide map preserves all supplied IDs, including repeated sequences. The audit found 3,074 repeated-sequence groups crossing gene labels, affecting 6,328 rows. These warrant annotation review; they are not genome alignment or off-target predictions. The four genes shown here have no sequences shared across gene labels in this workbook.')
add('No mouse-level replicate concordance, read mapping rate or physical graft cell coverage can be estimated from these two columns. Knockout-specific essential-gene dropout and DNA-cutting copy-number checks were disabled for CRISPRa. The Atlas has no comparable in vivo CRISPRa cohort for this screen, and no calibrated probability of functional validation is supplied.')
add('Files and provenance','Section')
add('The companion bundle includes the source workbook and publisher archive, canonical counts and library, all gene and guide CSVs, native MAGeCK outputs, SplicR JSON reports, timing logs, independent agreement results, normalization sensitivity, scripts and SHA-256 file hashes. The primary report records the actual local engine source fingerprint.','SmallCustom')
add('<b>Source paper and data:</b> <link href="https://doi.org/10.1093/stcltm/szag012" color="#2165B0">doi.org/10.1093/stcltm/szag012</link><br/><b>Official supplementary archive:</b> szag012_supplementary_data.zip, downloaded from the publisher.<br/><b>Method documentation:</b> <link href="https://sourceforge.net/p/mageck/wiki/Home/" color="#2165B0">MAGeCK official documentation</link>','SmallCustom')
def footer(canvas,doc):
    canvas.saveState();canvas.setStrokeColor(colors.HexColor('#D4DEE8'));canvas.line(48,42,564,42)
    canvas.setFont('Helvetica',8);canvas.setFillColor(muted)
    canvas.drawString(48,29,'SplicR | Millman 2026 published count-table reanalysis')
    canvas.drawRightString(564,29,f'{doc.page}');canvas.restoreState()
doc=SimpleDocTemplate(str(pdf),pagesize=(612,792),rightMargin=48,leftMargin=48,topMargin=43,bottomMargin=55,
                      title='SplicR analysis of the Millman CRISPRa transplantation screen',author='SplicR')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
print(pdf)
