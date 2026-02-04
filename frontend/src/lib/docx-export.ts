/**
 * Export TipTap/ProseMirror JSON content to DOCX
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ImageRun,
} from 'docx';
import { saveAs } from 'file-saver';
import type { TipTapDoc, TipTapNode } from '@/types/report';
import { journalPresets } from './journal-presets';

function getTextFromNode(node: TipTapNode): string {
  if (node.type === 'text' && 'text' in node && node.text) return node.text;
  if ('content' in node && Array.isArray(node.content)) {
    return node.content.map(getTextFromNode).join('');
  }
  return '';
}

function collectParagraphChildren(nodes: TipTapNode[]): (TextRun | ImageRun)[] {
  const runs: (TextRun | ImageRun)[] = [];
  for (const node of nodes) {
    if (node.type === 'text' && 'text' in node && node.text) {
      const marks = 'marks' in node && Array.isArray(node.marks) ? node.marks : [];
      const bold = marks.some((m: { type: string }) => m.type === 'bold');
      const italic = marks.some((m: { type: string }) => m.type === 'italic');
      runs.push(new TextRun({ text: node.text, bold, italics: italic }));
    }
    if (node.type === 'hardBreak') {
      runs.push(new TextRun({ text: '\n', break: 1 }));
    }
    if (node.type === 'image' && 'attrs' in node && node.attrs?.src) {
      // ImageRun requires buffer; for data URLs we'd need to fetch and convert
      // Skip or add placeholder for now
      runs.push(new TextRun({ text: '[Image]', italics: true }));
    }
  }
  return runs;
}

export function tipTapToDocxChildren(
  doc: TipTapDoc,
  journalKey: keyof typeof journalPresets = 'nature'
): Paragraph[] {
  const preset = journalPresets[journalKey];
  const children: Paragraph[] = [];

  if (!doc.content) return [new Paragraph({ text: 'Empty document.', spacing: { after: 200 } })];

  function walk(nodes: TipTapNode[]) {
    for (const node of nodes) {
      if (node.type === 'heading' && 'attrs' in node) {
        const level = (node.attrs as { level?: number })?.level ?? 2;
        const text = getTextFromNode(node);
        const headingLevel =
          level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
        children.push(
          new Paragraph({
            text,
            heading: headingLevel,
            spacing: { before: 400, after: 200 },
          })
        );
        continue;
      }
      if (node.type === 'paragraph' && 'content' in node && Array.isArray(node.content)) {
        const runs = collectParagraphChildren(node.content);
        if (runs.length > 0) {
          children.push(
            new Paragraph({
              children: runs,
              spacing: { after: 200 },
            })
          );
        } else {
          children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
        }
        continue;
      }
      if (node.type === 'bulletList' && 'content' in node && Array.isArray(node.content)) {
        for (const item of node.content) {
          if (item.type === 'listItem' && 'content' in item && Array.isArray(item.content)) {
            for (const p of item.content) {
              if (p.type === 'paragraph' && 'content' in p && Array.isArray(p.content)) {
                const runs = collectParagraphChildren(p.content);
                children.push(
                  new Paragraph({
                    children: runs.length ? runs : [new TextRun({ text: '•' })],
                    bullet: { level: 0 },
                    spacing: { after: 100 },
                  })
                );
              }
            }
          }
        }
        continue;
      }
      if ('content' in node && Array.isArray(node.content)) {
        walk(node.content);
      }
    }
  }

  walk(doc.content);
  if (children.length === 0) {
    children.push(new Paragraph({ text: 'No content.', spacing: { after: 200 } }));
  }
  return children;
}

export async function exportTipTapToDocx(
  doc: TipTapDoc,
  fileName: string,
  journalKey: keyof typeof journalPresets = 'nature'
): Promise<void> {

  const paragraphChildren = tipTapToDocxChildren(doc, journalKey);

  const document = new Document({
    sections: [
      {
        properties: {},
        children: paragraphChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(document);
  saveAs(blob, fileName || 'report.docx');
}
