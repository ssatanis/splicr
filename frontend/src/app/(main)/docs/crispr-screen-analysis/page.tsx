"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { ArrowLeft, Download, FileText } from "lucide-react";
import Button from "@/components/Button";
import "katex/dist/katex.min.css";
import styles from "./styles.module.css";

export default function CRISPRScreenDocs() {
  const [markdown, setMarkdown] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/docs/crispr-screen-analysis.md")
      .then((res) => res.text())
      .then((text) => {
        setMarkdown(text);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load documentation:", err);
        setIsLoading(false);
      });
  }, []);

  const handleDownloadPDF = () => {
    window.print();
  };

  const handleDownloadLaTeX = () => {
    const blob = new Blob([convertMarkdownToLaTeX(markdown)], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "crispr-screen-analysis.tex";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="max-w-[900px] mx-auto px-8 py-16">
        <div className="animate-pulse">
          <div className="h-12 bg-surface rounded w-3/4 mb-4"></div>
          <div className="h-4 bg-surface rounded w-1/2 mb-8"></div>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-4 bg-surface rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-8 py-16">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="mb-8"
      >
        <Link
          href="/docs"
          className="flex items-center gap-2 text-text-tertiary hover:text-accent transition-colors text-sm font-serif mb-8 group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Documentation
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-4xl md:text-5xl font-serif text-text-primary mb-2">
              CRISPR Screen Analysis
            </h1>
            <p className="text-text-secondary text-sm font-serif">
              Research-grade computational framework
            </p>
          </div>

          <div className="flex gap-3 print:hidden">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPDF}
              className="flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadLaTeX}
              className="flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Download LaTeX
            </Button>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className={styles.documentation}
      >
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            h1: ({ node, ...props }) => (
              <h1 className={styles.h1} {...props} />
            ),
            h2: ({ node, ...props }) => (
              <h2 className={styles.h2} {...props} />
            ),
            h3: ({ node, ...props }) => (
              <h3 className={styles.h3} {...props} />
            ),
            h4: ({ node, ...props }) => (
              <h4 className={styles.h4} {...props} />
            ),
            p: ({ node, ...props }) => <p className={styles.p} {...props} />,
            ul: ({ node, ...props }) => <ul className={styles.ul} {...props} />,
            ol: ({ node, ...props }) => <ol className={styles.ol} {...props} />,
            li: ({ node, ...props }) => <li className={styles.li} {...props} />,
            code: ({ node, inline, ...props }) =>
              inline ? (
                <code className={styles.inlineCode} {...props} />
              ) : (
                <code className={styles.codeBlock} {...props} />
              ),
            pre: ({ node, ...props }) => (
              <pre className={styles.pre} {...props} />
            ),
            blockquote: ({ node, ...props }) => (
              <blockquote className={styles.blockquote} {...props} />
            ),
            em: ({ node, ...props }) => <em className={styles.em} {...props} />,
            strong: ({ node, ...props }) => (
              <strong className={styles.strong} {...props} />
            ),
            hr: ({ node, ...props }) => <hr className={styles.hr} {...props} />,
            a: ({ node, ...props }) => <a className={styles.a} {...props} />,
            table: ({ node, ...props }) => (
              <div className={styles.tableWrapper}>
                <table className={styles.table} {...props} />
              </div>
            ),
            thead: ({ node, ...props }) => (
              <thead className={styles.thead} {...props} />
            ),
            tbody: ({ node, ...props }) => (
              <tbody className={styles.tbody} {...props} />
            ),
            tr: ({ node, ...props }) => (
              <tr className={styles.tr} {...props} />
            ),
            th: ({ node, ...props }) => (
              <th className={styles.th} {...props} />
            ),
            td: ({ node, ...props }) => (
              <td className={styles.td} {...props} />
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </motion.div>
    </div>
  );
}

// Helper function to convert markdown to LaTeX
function convertMarkdownToLaTeX(markdown: string): string {
  let latex = `\\documentclass[11pt,a4paper]{article}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage[utf8]{inputenc}
\\usepackage[margin=1in]{geometry}
\\usepackage{hyperref}
\\usepackage{graphicx}

\\title{CRISPR Screen Analysis — SplicR Documentation}
\\author{SplicR}
\\date{February 2026}

\\begin{document}

\\maketitle

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
    .replace(/`(.*?)`/g, "\\texttt{$1}")
    // Convert math delimiters (already in $ format)
    // Just ensure they're properly formatted
    .replace(/\$\$([\s\S]*?)\$\$/g, (match, equation) => {
      return `\\begin{equation}\n${equation.trim()}\n\\end{equation}`;
    })
    // Convert lists
    .replace(/^- (.*?)$/gm, "\\item $1")
    .replace(/^\d+\. (.*?)$/gm, "\\item $1")
    // Wrap itemize/enumerate
    .replace(
      /((?:\\item .*?\n)+)/g,
      (match) => `\\begin{itemize}\n${match}\\end{itemize}\n`
    )
    // Convert horizontal rules
    .replace(/^---$/gm, "\\vspace{1em}\\hrule\\vspace{1em}")
    // Escape special characters
    .replace(/%/g, "\\%")
    .replace(/&/g, "\\&");

  latex += content;
  latex += "\n\\end{document}";

  return latex;
}
