"""Two-page client brief, using the verified SplicR outputs and real brand asset."""
import csv
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.graphics.shapes import Drawing, Rect, Line, String

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output'
PDF=Path('/Users/sahaj/Documents/Projects/SplicR/output/pdf/SplicR-Millman-screen-analysis.pdf')
logo=ROOT/'input/splicr-wordmark-ink.png'
s=json.loads((OUT/'results_summary.json').read_text())
t=json.loads((OUT/'timing.json').read_text())
a=json.loads((OUT/'input_audit.json').read_text())
ink=colors.HexColor('#173D4D'); teal=colors.HexColor('#174F62'); orange=colors.HexColor('#D86235')
muted=colors.HexColor('#546772'); pale=colors.HexColor('#F0F5F6'); grid=colors.HexColor('#D7E2E6')
style={
    'title':ParagraphStyle('title',fontName='Helvetica-Bold',fontSize=23,leading=27,textColor=ink,spaceAfter=8),
    'sub':ParagraphStyle('sub',fontName='Helvetica',fontSize=10,leading=14,textColor=muted,spaceAfter=11),
    'section':ParagraphStyle('section',fontName='Helvetica-Bold',fontSize=13,leading=17,textColor=ink,spaceBefore=8,spaceAfter=6),
    'body':ParagraphStyle('body',fontName='Helvetica',fontSize=10,leading=13.5,textColor=ink,spaceAfter=6),
    'small':ParagraphStyle('small',fontName='Helvetica',fontSize=8.5,leading=11.5,textColor=muted,spaceAfter=6),
    'cell':ParagraphStyle('cell',fontName='Helvetica',fontSize=9.4,leading=12.5,textColor=ink),
    'head':ParagraphStyle('head',fontName='Helvetica-Bold',fontSize=9,leading=12,textColor=colors.white),
    'metric':ParagraphStyle('metric',fontName='Helvetica-Bold',fontSize=23,leading=27,textColor=teal),
}
story=[]
def p(x,k='body'):return Paragraph(x,style[k])
def add(x,k='body'):story.append(p(x,k))
def table(head,rows,widths):
    tab=Table([[p(v,'head') for v in head]]+[[p(str(v),'cell') for v in row] for row in rows],colWidths=widths,hAlign='LEFT')
    tab.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),teal),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,pale]),
        ('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),
        ('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LINEBELOW',(0,-1),(-1,-1),.5,grid)]))
    story.append(tab)

add('CRISPRa transplant screen','title')
add('Millman lab | Maestas et al., 2026<br/>Day-10 kidney graft endpoint versus differentiated day 0 (D0).','sub')
cards=Table([[p('106,400','metric'),p('20 / 20','metric'),p('59.94 sec','metric')],
    [p('Published guides analyzed','small'),p('Published top-20 genes recovered','small'),p('Total measured computation','small')]],colWidths=[172,172,172])
cards.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),pale),('LEFTPADDING',(0,0),(-1,-1),12),
    ('TOPPADDING',(0,0),(-1,0),8),('BOTTOMPADDING',(0,1),(-1,1),5),('VALIGN',(0,0),(-1,-1),'TOP')]))
story.append(cards)
add('MAGeCK results, with the evidence behind each candidate','section')
add('SplicR combines MAGeCK RRA with sample-quality checks, guide-support flags and a traceable report. An independent MAGeCK run matched <b>all 13 numeric gene-result columns exactly</b>. SplicR also recovered the publication\'s <b>same top-20 genes</b>, with some ordering differences.')
add('1. Was the guide library still represented?','section')
table(['Sample','Guides detected','Guides with zero counts','Mean counts per guide'],[
    ['Differentiated D0','106,358 / 106,400<br/><b>99.96%</b>','42','628.9'],
    ['Day-10 kidney endpoint','106,358 / 106,400<br/><b>99.96%</b>','42','578.6']], [143,150,113,110])
add('Only five guides detected at D0 were absent at the endpoint. These are aggregate counts, so individual-graft representation cannot be assessed.','small')
add('2. Which ranked candidates have support across guides?','section')
table(['Gene','Enrichment rank','Guides moving upward','Largest guide share*'],[
    [g,s['key_genes'][g]['enrichment_rank'],f"{s['key_genes'][g]['guides_with_positive_LFC']} of 5",f"{float(s['key_genes'][g]['max_absolute_guide_effect_share']):.0%}"]
    for g in ['SIX3','FCAMR','GSTM3','HSF2']], [89,121,158,148])
add('<b>41 of the 190 top-ranked candidates received a guide-support flag.</b> Each flag includes its measured evidence for review before follow-up experiments.')
add('*Share of the sum of absolute guide log2 fold changes. Flags prompt review; they do not establish false positives.','small')
add('<b>Candidate ranking is separate from significance.</b> No gene passed 10% directional FDR in either normalization run. These are exploratory candidates, and this reanalysis does not replace the paper\'s functional validation.','small')

story.append(PageBreak())
add('Evidence for follow-up','title')
add('A concrete example from your data: FCAMR versus HSF2.','sub')

def guide_plot():
    d=Drawing(516,132)
    rows=list(csv.DictReader((OUT/'key_gene_guide_results.csv').open()))
    for n,g in enumerate(['FCAMR','HSF2']):
        left=n*267;top=119;x0=left+35;width=189
        def x(v):return x0+(v+.5)/5.2*width
        d.add(String(left,top,g,fontName='Helvetica-Bold',fontSize=11,fillColor=ink))
        for tick in [0,1,2,3,4]:
            d.add(Line(x(tick),top-95,x(tick),top-16,strokeColor=grid,strokeWidth=.6))
            d.add(String(x(tick)-2,top-107,str(tick),fontSize=8,fillColor=muted))
        for i,r in enumerate(sorted([r for r in rows if r['Gene']==g],key=lambda r:r['sgrna'])):
            v=float(r['LFC']);y=top-27-i*15
            d.add(String(left,y+1,f'g{i+1}',fontSize=8.5,fillColor=muted))
            d.add(Rect(min(x(v),x(0)),y,max(abs(x(v)-x(0)),.6),10,fillColor=teal if v>0 else orange,strokeColor=None))
            d.add(String((x(v) if v>0 else x(0))+4,y+1,f'{v:+.2f}',fontSize=8,fillColor=ink))
    return d
story.append(guide_plot())
add('Per-guide log2 fold changes on the same scale. Positive values mean increased endpoint representation; orange bars mean decreased representation.','small')
add('<b>FCAMR:</b> four guides move upward; no single-guide flag.<br/><b>HSF2:</b> ranked second, but one guide contributes 89% of the absolute guide effect. SplicR flags it using its 60% concentration threshold.')
add('3. Does the result depend on normalization?','section')
add('Using the <b>3,755 non-targeting controls</b> for normalization, SIX3, FCAMR and GSTM3 kept positive gene effects and ranks <b>1, 9 and 11</b>, versus <b>1, 8 and 10</b> in the main run. The named candidates remain high-ranked under both choices.')
add('How we produced the analysis','section')
table(['Step','What we did'],[
    ['Validate and QC','Checked all guide IDs, sequences and counts; confirmed D0 as the reference; measured guide detection, depth and count distribution.'],
    ['Rank and review','Ran MAGeCK RRA and preserved its statistics; applied SplicR guide-concentration and agreement checks.'],
    ['Verify and export','Checked standalone MAGeCK agreement and control normalization; exported full gene/guide tables, settings and file hashes.']], [100,416])
add('<b>Measured computation:</b> main SplicR pipeline <b>21.93 sec</b>; with input preparation <b>25.36 sec</b>; all analysis, verification and CSV exports <b>59.94 sec</b>. The total sums timed execution phases; download, setup and document creation are excluded.','small')
add('<b>For your next screen:</b> review guide support before committing to overexpression and transplant follow-up. Counts for each graft would also allow checks of agreement between grafts.')
add('<b>Scope:</b> no mouse-level reproducibility, mapping rate or validation probability was inferred. Shared-sequence gene-label ambiguities remain in the full audit.','small')
add('<b>Source:</b> <link href="https://doi.org/10.1093/stcltm/szag012" color="#174F62">Maestas et al., DOI 10.1093/stcltm/szag012</link>, Source_Data.xlsx. MAGeCK 0.5.9.5; same counts, contrast and median normalization in the independent check. Full tables accompany this brief.','small')

def frame(canvas,doc):
    canvas.saveState()
    canvas.setFont('Helvetica-Bold',8);canvas.setFillColor(muted)
    canvas.drawString(48,755,'PUBLISHED SCREEN ANALYSIS  /  08 OCT 2026')
    canvas.drawImage(str(logo),464,743,width=100,height=33.89,mask='auto')
    canvas.setStrokeColor(grid);canvas.line(48,736,564,736)
    canvas.line(48,42,564,42);canvas.setFont('Helvetica',8)
    canvas.drawString(48,29,'SplicR | Evidence for CRISPR screen follow-up')
    canvas.drawRightString(564,29,f'{doc.page} / 2')
    canvas.restoreState()

doc=SimpleDocTemplate(str(PDF),pagesize=(612,792),leftMargin=48,rightMargin=48,topMargin=73,bottomMargin=54,
    title='SplicR analysis of the Millman CRISPRa transplantation screen',author='SplicR')
doc.build(story,onFirstPage=frame,onLaterPages=frame)
print(PDF)
