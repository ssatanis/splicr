import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { inspectContext, CONTEXT_BYTES } from '../src/lib/intake/context.ts';
import { expandExperimentFiles } from '../src/lib/intake/archive.ts';

function pdf(text) {
  const stream = `BT /F1 12 Tf 40 750 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(output.length); output += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = output.length;
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(output);
}

test('reads complete text and labels a bounded preview', async () => {
  const result = await inspectContext(strToU8('Experiment protocol\n'.repeat(500)), 'protocol.md');
  assert.equal(result.inspection, 'read');
  assert.equal(result.text.length, 6000);
  assert.ok(result.characters > result.text.length);
  assert.match(result.warnings.join(' '), /first 6,000/);
  const partial = await inspectContext(strToU8('partial'), 'notes.log', false);
  assert.equal(partial.inspection, 'partial');
  assert.match(partial.warnings.join(' '), /16 MB/);
  assert.equal(CONTEXT_BYTES, 16 * 1024 * 1024);
});

test('extracts UTF-16 text without inventing binary content', async () => {
  const result = await inspectContext(Buffer.concat([Buffer.from([255,254]), Buffer.from('Cell line: HAP1','utf16le')]), 'notes.txt');
  assert.match(result.text, /HAP1/);
  const binary = await inspectContext(new Uint8Array([0,255,0,125]), 'instrument.bin');
  assert.equal(binary.inspection, 'retained');
  assert.equal(binary.text, undefined);
});

test('reads Word paragraphs, table cells and footnotes in document order', async () => {
  const bytes = zipSync({
    'word/document.xml': strToU8('<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>Cell line: HAP1 &amp; controls</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Olaparib</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'),
    'word/footnotes.xml': strToU8('<w:footnotes><w:p><w:r><w:t>Replicate 2</w:t></w:r></w:p></w:footnotes>'),
    'word/vbaProject.bin': new Uint8Array([0,255]),
  });
  const result = await inspectContext(bytes, 'design.docx');
  assert.equal(result.inspection, 'read');
  assert.match(result.text, /Cell line: HAP1 & controls\nOlaparib/);
  assert.match(result.text, /Replicate 2/);
  assert.match(result.warnings.join(' '), /macros are not interpreted/);
  const empty = await inspectContext(zipSync({'word/document.xml':strToU8('<w:document><w:p/></w:document>')}), 'image-only.docx');
  assert.equal(empty.inspection, 'retained');
});

test('extracts PowerPoint slides in numeric order and OpenDocument paragraphs', async () => {
  const slide = text => strToU8(`<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`);
  const result = await inspectContext(zipSync({'ppt/slides/slide10.xml':slide('tenth'),'ppt/slides/slide2.xml':slide('second')}), 'design.pptx');
  assert.ok(result.text.indexOf('second') < result.text.indexOf('tenth'));
  const odt = await inspectContext(zipSync({'content.xml':strToU8('<office:document><text:p>Control <text:span>DMSO</text:span></text:p></office:document>')}), 'design.odt');
  assert.match(odt.text, /Control DMSO/);
});

test('reads text from a real PDF and flags scanned content separately', async () => {
  const result = await inspectContext(pdf('Experiment control: DMSO'), 'protocol.pdf');
  assert.equal(result.inspection, 'read');
  assert.equal(result.pages, 1);
  assert.match(result.text, /Experiment control: DMSO/);
  assert.match(result.warnings.join(' '), /scanned pages require OCR/);
});

test('malformed and oversized documents remain attached with explicit limits', async () => {
  for (const name of ['bad.pdf','bad.docx','bad.png']) {
    const result = await inspectContext(strToU8('not a real document'), name);
    assert.equal(result.inspection, 'retained');
    assert.equal(result.text, undefined);
  }
  assert.equal((await inspectContext(pdf('test'), 'big.pdf', false)).inspection, 'retained');
  const result = await inspectContext(zipSync({'word/document.xml':strToU8('<!DOCTYPE t [<!ENTITY unsafe "value">]><w:t>&unsafe;</w:t>')}), 'entities.docx');
  assert.equal(result.inspection, 'retained');
});

test('HTML scripts are excluded and archive source bytes are preserved', async () => {
  const html = await inspectContext(strToU8('<script>alert(1)</script><p>Protocol</p>'), 'protocol.html');
  assert.match(html.text, /Protocol/);
  assert.doesNotMatch(html.text, /alert/);
  const archive = new File([zipSync({'counts.tsv':strToU8('guide\tcontrol\ttreated\na\t10\t2\n')})], 'bundle.zip');
  const files = await expandExperimentFiles([archive]);
  assert.equal(files[0], archive);
  assert.equal(files[1].name, 'bundle/counts.tsv');
  assert.match(await files[1].text(), /control/);
});
