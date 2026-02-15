/**
 * Documentation export utilities for PDF and LaTeX generation
 */

/**
 * Convert markdown content to LaTeX format
 */
export function convertMarkdownToLaTeX(markdown: string): string {
  let latex = `\\documentclass[11pt,a4paper]{article}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}
\\usepackage{hyperref}
\\usepackage{graphicx}
\\usepackage{listings}
\\usepackage{xcolor}

\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,      
    urlcolor=cyan,
}

\\lstset{
    basicstyle=\\ttfamily\\small,
    breaklines=true,
    frame=single,
    backgroundcolor=\\color{gray!10}
}

\\title{CRISPR Screen Analysis — SplicR Documentation}
\\author{SplicR}
\\date{February 2026}

\\begin{document}

\\maketitle
\\tableofcontents
\\newpage

`;

  // Convert markdown to LaTeX (basic conversion)
  let content = markdown
    // Remove frontmatter if any
    .replace(/^---[\s\S]*?---\n/, "")
    // Convert headers
    .replace(/^# (.*?)$/gm, "\\section{$1}")
    .replace(/^## (.*?)$/gm, "\\subsection{$1}")
    .replace(/^### (.*?)$/gm, "\\subsubsection{$1}")
    .replace(/^#### (.*?)$/gm, "\\paragraph{$1}")
    // Convert bold and italic
    .replace(/\*\*\*(.*?)\*\*\*/g, "\\textbf{\\textit{$1}}")
    .replace(/\*\*(.*?)\*\*/g, "\\textbf{$1}")
    .replace(/\*(.*?)\*/g, "\\textit{$1}")
    // Convert inline code
    .replace(/`([^`]+)`/g, "\\texttt{$1}")
    // Convert display math (already in $$ format)
    .replace(/\$\$([\s\S]*?)\$\$/g, (match, equation) => {
      return `\\begin{equation}\n${equation.trim()}\n\\end{equation}\n`;
    })
    // Convert lists (itemize)
    .replace(/^- (.*?)$/gm, "\\item $1")
    .replace(/^\d+\. (.*?)$/gm, "\\item $1")
    // Convert horizontal rules
    .replace(/^---+$/gm, "\n\\noindent\\rule{\\textwidth}{0.4pt}\n")
    // Escape special LaTeX characters (but preserve math mode)
    .replace(/#/g, "\\#")
    .replace(/%/g, "\\%")
    .replace(/&/g, "\\&")
    .replace(/_/g, "\\_");

  // Wrap consecutive \item commands in itemize environment
  content = content.replace(
    /((?:\\item .*?\n)+)/g,
    (match) => `\n\\begin{itemize}\n${match}\\end{itemize}\n`
  );

  latex += content;
  latex += "\n\\end{document}";

  return latex;
}

/**
 * Generate PDF using browser's print functionality
 * This is the simplest approach that works well for documentation
 */
export function exportToPDF(): void {
  // Use browser's native print dialog which allows saving as PDF
  window.print();
}

/**
 * Download LaTeX source file
 */
export function downloadLaTeX(markdown: string, filename = "crispr-screen-analysis.tex"): void {
  const latexContent = convertMarkdownToLaTeX(markdown);
  const blob = new Blob([latexContent], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Download markdown file
 */
export function downloadMarkdown(markdown: string, filename = "crispr-screen-analysis.md"): void {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
