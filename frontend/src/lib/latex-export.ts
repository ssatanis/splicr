/**
 * Export TipTap/ProseMirror JSON content to LaTeX
 */

import type { TipTapDoc, TipTapNode, JournalPresetKey } from '@/types/report';
import { journalPresets } from './journal-presets';

function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, '\\$&')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function getTextFromNode(node: TipTapNode): string {
  if (node.type === 'text' && 'text' in node && node.text) {
    return node.text;
  }
  if ('content' in node && Array.isArray(node.content)) {
    return node.content.map(getTextFromNode).join('');
  }
  return '';
}

function collectParagraphText(nodes: TipTapNode[]): string {
  let result = '';
  for (const node of nodes) {
    if (node.type === 'text' && 'text' in node && node.text) {
      const marks = 'marks' in node && Array.isArray(node.marks) ? node.marks : [];
      let text = escapeLatex(node.text);
      
      // Apply formatting
      for (const mark of marks) {
        if (mark.type === 'bold') {
          text = `\\textbf{${text}}`;
        }
        if (mark.type === 'italic') {
          text = `\\textit{${text}}`;
        }
      }
      result += text;
    }
    if (node.type === 'hardBreak') {
      result += '\\\\\n';
    }
  }
  return result;
}

export function tipTapToLatex(
  doc: TipTapDoc,
  journalKey: JournalPresetKey = 'nature'
): string {
  const preset = journalPresets[journalKey];
  let latex = '';

  // LaTeX preamble
  latex += `\\documentclass[11pt,a4paper]{article}\n`;
  latex += `\\usepackage[utf8]{inputenc}\n`;
  latex += `\\usepackage[T1]{fontenc}\n`;
  latex += `\\usepackage{graphicx}\n`;
  latex += `\\usepackage{amsmath}\n`;
  latex += `\\usepackage{hyperref}\n`;
  latex += `\\usepackage{geometry}\n`;
  latex += `\\geometry{margin=1in}\n`;
  
  // Font settings based on journal
  if (preset.text_specs.font_family.toLowerCase().includes('times')) {
    latex += `\\usepackage{times}\n`;
  } else if (preset.text_specs.font_family.toLowerCase().includes('arial')) {
    latex += `\\usepackage{helvet}\n\\renewcommand{\\familydefault}{\\sfdefault}\n`;
  }
  
  latex += `\n\\begin{document}\n\n`;

  if (!doc.content || doc.content.length === 0) {
    latex += `No content.\n\n`;
  } else {
    function walk(nodes: TipTapNode[], listLevel: number = 0) {
      for (const node of nodes) {
        if (node.type === 'heading' && 'attrs' in node) {
          const level = (node.attrs as { level?: number })?.level ?? 2;
          const text = escapeLatex(getTextFromNode(node));
          
          if (level === 1) {
            latex += `\\section{${text}}\n\n`;
          } else if (level === 2) {
            latex += `\\subsection{${text}}\n\n`;
          } else {
            latex += `\\subsubsection{${text}}\n\n`;
          }
          continue;
        }
        
        if (node.type === 'paragraph' && 'content' in node && Array.isArray(node.content)) {
          const text = collectParagraphText(node.content);
          if (text.trim()) {
            latex += `${text}\n\n`;
          } else {
            latex += `\\vspace{\\baselineskip}\n\n`;
          }
          continue;
        }
        
        if (node.type === 'bulletList' && 'content' in node && Array.isArray(node.content)) {
          latex += `\\begin{itemize}\n`;
          for (const item of node.content) {
            if (item.type === 'listItem' && 'content' in item && Array.isArray(item.content)) {
              latex += `\\item `;
              for (const p of item.content) {
                if (p.type === 'paragraph' && 'content' in p && Array.isArray(p.content)) {
                  const text = collectParagraphText(p.content);
                  latex += text;
                }
              }
              latex += `\n`;
            }
          }
          latex += `\\end{itemize}\n\n`;
          continue;
        }
        
        if (node.type === 'orderedList' && 'content' in node && Array.isArray(node.content)) {
          latex += `\\begin{enumerate}\n`;
          for (const item of node.content) {
            if (item.type === 'listItem' && 'content' in item && Array.isArray(item.content)) {
              latex += `\\item `;
              for (const p of item.content) {
                if (p.type === 'paragraph' && 'content' in p && Array.isArray(p.content)) {
                  const text = collectParagraphText(p.content);
                  latex += text;
                }
              }
              latex += `\n`;
            }
          }
          latex += `\\end{enumerate}\n\n`;
          continue;
        }
        
        if ('content' in node && Array.isArray(node.content)) {
          walk(node.content, listLevel);
        }
      }
    }

    walk(doc.content);
  }

  latex += `\\end{document}\n`;
  return latex;
}

export function exportTipTapToLatex(
  doc: TipTapDoc,
  fileName: string,
  journalKey: JournalPresetKey = 'nature'
): void {
  const latexContent = tipTapToLatex(doc, journalKey);
  
  // Create blob and download
  const blob = new Blob([latexContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.tex') ? fileName : `${fileName}.tex`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
