"use client";

import { useCallback, useEffect, useState } from "react";
import { useEditor, EditorContent, type Content } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { fillPlaceholders, getDefaultAnalysisContext } from "@/lib/template-engine";
import { exportTipTapToDocx } from "@/lib/docx-export";
import { exportElementToPdf } from "@/lib/pdf-export";
import { defaultTemplates } from "@/lib/default-templates";
import { journalPresets } from "@/lib/journal-presets";
import type { TipTapDoc, AnalysisContextForReport, JournalPresetKey } from "@/types/report";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
  Heading3,
  FileText,
  Download,
} from "lucide-react";

const extensions = [
  StarterKit.configure({ heading: { levels: [2, 3] } }),
  Placeholder.configure({ placeholder: "Start writing or load a template…" }),
  Image.configure({ inline: false, allowBase64: true }),
];

interface ReportBuilderProps {
  analysisContext?: Partial<AnalysisContextForReport>;
  onClose?: () => void;
  initialTitle?: string;
}

export default function ReportBuilder({
  analysisContext,
  onClose,
  initialTitle = "Report",
}: ReportBuilderProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState(0);
  const [journalPreset, setJournalPreset] = useState<JournalPresetKey>("nature");
  const [title, setTitle] = useState(initialTitle);
  const [wordCount, setWordCount] = useState(0);
  const [exporting, setExporting] = useState(false);

  const context: AnalysisContextForReport = {
    ...getDefaultAnalysisContext(),
    ...analysisContext,
  };

  const loadTemplateContent = useCallback(
    (templateIndex: number): Content => {
      const template = defaultTemplates[templateIndex];
      if (!template?.structure) return { type: "doc", content: [] };
      const filled = fillPlaceholders(template.structure, context);
      return filled as Content;
    },
    [
      context.analysisName,
      context.libraryName,
      context.method,
      context.totalGenes,
      context.significantHits,
      context.enriched,
      context.depleted,
      context.fdrThreshold,
      context.lfcThreshold,
    ]
  );

  const editor = useEditor({
    extensions,
    content: loadTemplateContent(0),
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[320px] px-6 py-5 rounded-2xl focus:outline-none text-text-primary bg-surface/30 border border-border/60",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const content = loadTemplateContent(selectedTemplateId);
    editor.commands.setContent(content);
  }, [selectedTemplateId, editor, loadTemplateContent]);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const text = editor.getText();
      setWordCount(text.split(/\s+/).filter(Boolean).length);
    };
    editor.on("update", update);
    update();
    return () => {
      editor.off("update", update);
    };
  }, [editor]);

  const handleExportDocx = async () => {
    if (!editor) return;
    setExporting(true);
    try {
      const doc = editor.getJSON() as TipTapDoc;
      await exportTipTapToDocx(
        doc,
        `${title.replace(/\s+/g, "-")}.docx`,
        journalPreset
      );
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    const el = document.querySelector(".ProseMirror") as HTMLElement;
    if (!el) return;
    setExporting(true);
    try {
      const wrapper = document.createElement("div");
      wrapper.style.background = "white";
      wrapper.style.padding = "24px";
      wrapper.style.maxWidth = "210mm";
      wrapper.style.margin = "0 auto";
      wrapper.appendChild(el.cloneNode(true));
      await exportElementToPdf(wrapper, {
        fileName: `${title.replace(/\s+/g, "-")}.pdf`,
        dpi: 150,
        widthMm: 210,
        heightMm: 297,
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border/80 bg-surface/50 backdrop-blur-sm rounded-b-2xl">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-lg font-semibold text-text-primary bg-transparent border-b-2 border-border focus:outline-none focus:border-success px-3 py-1 w-52 rounded-t transition-colors"
          placeholder="Report title"
        />
        <div className="h-6 w-px bg-border/80" />
        {editor && (
          <>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-2.5 rounded-xl hover:bg-background/80 transition-colors ${editor.isActive("bold") ? "bg-accent/30 text-text-primary" : "text-text-secondary"}`}
              title="Bold"
            >
              <Bold className="w-4 h-4 text-text-primary" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-2.5 rounded-xl hover:bg-background/80 transition-colors ${editor.isActive("italic") ? "bg-accent/30 text-text-primary" : "text-text-secondary"}`}
              title="Italic"
            >
              <Italic className="w-4 h-4 text-text-primary" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`p-2.5 rounded-xl hover:bg-background/80 transition-colors ${editor.isActive("heading", { level: 2 }) ? "bg-accent/30 text-text-primary" : "text-text-secondary"}`}
              title="Heading 2"
            >
              <Heading2 className="w-4 h-4 text-text-primary" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={`p-2.5 rounded-xl hover:bg-background/80 transition-colors ${editor.isActive("heading", { level: 3 }) ? "bg-accent/30 text-text-primary" : "text-text-secondary"}`}
              title="Heading 3"
            >
              <Heading3 className="w-4 h-4 text-text-primary" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`p-2.5 rounded-xl hover:bg-background/80 transition-colors ${editor.isActive("bulletList") ? "bg-accent/30 text-text-primary" : "text-text-secondary"}`}
              title="Bullet list"
            >
              <List className="w-4 h-4 text-text-primary" />
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              className={`p-2.5 rounded-xl hover:bg-background/80 transition-colors ${editor.isActive("orderedList") ? "bg-accent/30 text-text-primary" : "text-text-secondary"}`}
              title="Numbered list"
            >
              <ListOrdered className="w-4 h-4 text-text-primary" />
            </button>
          </>
        )}
        <div className="h-6 w-px bg-border/80 ml-1" />
        <label className="text-xs text-text-tertiary flex items-center gap-2">
          Template
          <select
            value={selectedTemplateId}
            onChange={(e) => setSelectedTemplateId(Number(e.target.value))}
            className="bg-background/80 border border-border rounded-xl px-3 py-2 text-text-primary text-sm focus:ring-2 focus:ring-success/30 focus:outline-none transition-shadow"
          >
            {defaultTemplates.map((t, i) => (
              <option key={i} value={i}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-text-tertiary flex items-center gap-2">
          Journal
          <select
            value={journalPreset}
            onChange={(e) => setJournalPreset(e.target.value as JournalPresetKey)}
            className="bg-background/80 border border-border rounded-xl px-3 py-2 text-text-primary text-sm focus:ring-2 focus:ring-success/30 focus:outline-none transition-shadow"
          >
            {Object.keys(journalPresets).map((key) => (
              <option key={key} value={key}>
                {journalPresets[key as JournalPresetKey].journal_name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex-1" />
        <span className="text-xs text-text-tertiary font-medium">{wordCount} words</span>
        <button
          type="button"
          onClick={handleExportDocx}
          disabled={exporting}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-success/20 text-success hover:bg-success/30 text-sm font-medium disabled:opacity-50 transition-colors"
        >
          <FileText className="w-4 h-4" />
          Export DOCX
        </button>
        <button
          type="button"
          onClick={handleExportPdf}
          disabled={exporting}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/20 text-text-primary hover:bg-accent/30 text-sm font-medium disabled:opacity-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
