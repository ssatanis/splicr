"use client";

import { useRef, useState, useCallback } from "react";
import { journalPresets, mmToPx, dpiToPixelRatio } from "@/lib/journal-presets";
import type { VolcanoPlotPoint } from "@/types/report";
import type { JournalPresetKey } from "@/types/report";
import { saveAs } from "file-saver";
import jsPDF from "jspdf";
import { Download, Image as ImageIcon } from "lucide-react";

const CANVAS_PADDING = 60;
const DEFAULT_WIDTH = 520;
const DEFAULT_HEIGHT = 520;

interface FigureCustomizationStudioProps {
  volcanoData: VolcanoPlotPoint[];
  figureName?: string;
  onClose?: () => void;
}

function getBounds(data: VolcanoPlotPoint[]) {
  let minX = 0,
    maxX = 0,
    minY = 0,
    maxY = 0;
  for (const p of data) {
    minX = Math.min(minX, p.log2FC);
    maxX = Math.max(maxX, p.log2FC);
    minY = Math.min(minY, p.negLog10P);
    maxY = Math.max(maxY, p.negLog10P);
  }
  const padX = Math.max(0.5, (maxX - minX) * 0.05);
  const padY = Math.max(0.5, (maxY - minY) * 0.05);
  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minY: 0,
    maxY: maxY + padY,
  };
}

function transformToCanvas(
  log2FC: number,
  negLog10P: number,
  bounds: ReturnType<typeof getBounds>,
  width: number,
  height: number
) {
  const x =
    CANVAS_PADDING +
    ((log2FC - bounds.minX) / (bounds.maxX - bounds.minX)) *
      (width - 2 * CANVAS_PADDING);
  const y =
    height -
    CANVAS_PADDING -
    (negLog10P / bounds.maxY) * (height - 2 * CANVAS_PADDING);
  return { x, y };
}

/** Export SVG element to PNG at given DPI via canvas */
function svgToPngDataUrl(svgEl: SVGSVGElement, dpi: number): Promise<string> {
  const scale = dpi / 96;
  const w = svgEl.width.baseVal.value;
  const h = svgEl.height.baseVal.value;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve("");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const data = new XMLSerializer().serializeToString(svgEl);
  const dataUrl = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(data)));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}

export default function FigureCustomizationStudio({
  volcanoData,
  figureName = "volcano-plot",
}: FigureCustomizationStudioProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [journalPreset, setJournalPreset] = useState<JournalPresetKey>("nature");
  const [significantColor, setSignificantColor] = useState("#e74c3c");
  const [nonsigColor, setNonsigColor] = useState("#95a5a6");
  const [fontSize, setFontSize] = useState(12);
  const [canvasSize, setCanvasSize] = useState({ w: DEFAULT_WIDTH, h: DEFAULT_HEIGHT });

  const preset = journalPresets[journalPreset];
  const dpi = preset?.figure_specs?.resolution?.recommended ?? 600;
  const bounds = getBounds(volcanoData);
  const width = canvasSize.w;
  const height = canvasSize.h;

  const applyPresetDimensions = useCallback(() => {
    const singleCol = preset?.figure_specs?.dimensions?.single_column;
    if (singleCol?.width) {
      const pxW = mmToPx(singleCol.width, dpi);
      const pxH = pxW;
      setCanvasSize({ w: Math.min(pxW, 1200), h: Math.min(pxH, 1200) });
    }
    const recSize = preset?.figure_specs?.fonts?.recommended_size;
    if (recSize) setFontSize(recSize);
  }, [preset, dpi]);

  const handleExportPng = useCallback(async () => {
    if (!svgRef.current) return;
    const dataUrl = await svgToPngDataUrl(svgRef.current, dpi);
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.download = `${figureName}.png`;
    link.href = dataUrl;
    link.click();
  }, [dpi, figureName]);

  const handleExportSvg = useCallback(() => {
    const w = width;
    const h = height;
    const zeroX = transformToCanvas(0, 0, bounds, w, h).x;
    const axisY = h - CANVAS_PADDING;
    const axisX = CANVAS_PADDING;
    const yAxisEnd = CANVAS_PADDING;
    const xAxisEnd = w - CANVAS_PADDING;
    let circles = "";
    volcanoData.forEach((p) => {
      const { x, y } = transformToCanvas(p.log2FC, p.negLog10P, bounds, w, h);
      const fill = p.isSignificant ? significantColor : nonsigColor;
      circles += `<circle cx="${x}" cy="${y}" r="3" fill="${fill}"/>`;
    });
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="white"/>
  <line x1="${axisX}" y1="${axisY}" x2="${xAxisEnd}" y2="${axisY}" stroke="#333" stroke-width="1.5"/>
  <line x1="${axisX}" y1="${axisY}" x2="${axisX}" y2="${yAxisEnd}" stroke="#333" stroke-width="1.5"/>
  <line x1="${zeroX}" y1="${axisY}" x2="${zeroX}" y2="${yAxisEnd}" stroke="#999" stroke-width="0.5" stroke-dasharray="4 4"/>
  <text x="${w / 2 - 30}" y="${h - 20}" font-family="Arial" font-size="${fontSize}" fill="#333">log₂ FC</text>
  <text x="20" y="${h / 2}" font-family="Arial" font-size="${fontSize}" fill="#333" transform="rotate(-90 20 ${h / 2})">-log₁₀(p)</text>
  ${circles}
</svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    saveAs(blob, `${figureName}.svg`);
  }, [figureName, width, height, bounds, volcanoData, significantColor, nonsigColor, fontSize]);

  const handleExportPdf = useCallback(async () => {
    if (!svgRef.current) return;
    const dataUrl = await svgToPngDataUrl(svgRef.current, dpi);
    if (!dataUrl) return;
    const singleCol = preset?.figure_specs?.dimensions?.single_column;
    const wMm = singleCol?.width ?? 88;
    const hMm = wMm;
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: [wMm, hMm],
    });
    pdf.addImage(dataUrl, "PNG", 0, 0, wMm, hMm);
    pdf.save(`${figureName}.pdf`);
  }, [dpi, preset, figureName]);

  if (!volcanoData.length) {
    return (
      <div className="flex items-center justify-center h-96 bg-surface/80 rounded-2xl border border-border backdrop-blur-sm">
        <p className="text-text-tertiary font-medium">No volcano data to customize.</p>
      </div>
    );
  }

  const axisY = height - CANVAS_PADDING;
  const axisX = CANVAS_PADDING;
  const xAxisEnd = width - CANVAS_PADDING;
  const yAxisEnd = CANVAS_PADDING;
  const zeroX = transformToCanvas(0, 0, bounds, width, height).x;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-border/80 bg-surface/50 backdrop-blur-sm rounded-b-2xl">
        <span className="text-sm font-semibold text-text-primary">Figure</span>
        <label className="text-xs text-text-tertiary flex items-center gap-2">
          Journal
          <select
            value={journalPreset}
            onChange={(e) => {
              setJournalPreset(e.target.value as JournalPresetKey);
              applyPresetDimensions();
            }}
            className="bg-background/80 border border-border rounded-xl px-3 py-2 text-text-primary text-sm focus:ring-2 focus:ring-success/30 focus:outline-none transition-shadow"
          >
            {Object.keys(journalPresets).map((key) => (
              <option key={key} value={key}>
                {journalPresets[key as JournalPresetKey].journal_name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={applyPresetDimensions}
          className="text-xs px-3 py-2 rounded-xl border border-border hover:bg-background/80 text-text-primary transition-colors"
        >
          Apply preset size
        </button>
        <div className="h-6 w-px bg-border/80" />
        <label className="text-xs text-text-tertiary flex items-center gap-2">
          Significant
          <input
            type="color"
            value={significantColor}
            onChange={(e) => setSignificantColor(e.target.value)}
            className="w-8 h-8 rounded-xl border border-border cursor-pointer shadow-inner"
          />
        </label>
        <label className="text-xs text-text-tertiary flex items-center gap-2">
          Non-significant
          <input
            type="color"
            value={nonsigColor}
            onChange={(e) => setNonsigColor(e.target.value)}
            className="w-8 h-8 rounded-xl border border-border cursor-pointer shadow-inner"
          />
        </label>
        <label className="text-xs text-text-tertiary flex items-center gap-2">
          Font size
          <input
            type="number"
            min={5}
            max={24}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-16 bg-background/80 border border-border rounded-xl px-2 py-2 text-text-primary text-sm focus:ring-2 focus:ring-success/30 focus:outline-none"
          />
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleExportPng}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-success/20 text-success hover:bg-success/30 text-sm font-medium transition-colors"
        >
          <ImageIcon className="w-4 h-4" />
          PNG ({dpi} DPI)
        </button>
        <button
          type="button"
          onClick={handleExportSvg}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/20 text-text-primary hover:bg-accent/30 text-sm font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          SVG
        </button>
        <button
          type="button"
          onClick={handleExportPdf}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/20 text-text-primary hover:bg-accent/30 text-sm font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          PDF
        </button>
      </div>

      {/* Canvas: inline SVG */}
      <div className="flex-1 overflow-auto p-6 flex items-center justify-center min-h-0">
        <div className="rounded-2xl shadow-lg border border-border/60 overflow-hidden bg-white transition-shadow hover:shadow-xl">
          <svg
            ref={svgRef}
            width={width}
            height={height}
            className="block"
            style={{ minWidth: width, minHeight: height }}
          >
            <rect width="100%" height="100%" fill="white" />
            <line
              x1={axisX}
              y1={axisY}
              x2={xAxisEnd}
              y2={axisY}
              stroke="#333"
              strokeWidth={1.5}
            />
            <line
              x1={axisX}
              y1={axisY}
              x2={axisX}
              y2={yAxisEnd}
              stroke="#333"
              strokeWidth={1.5}
            />
            <line
              x1={zeroX}
              y1={axisY}
              x2={zeroX}
              y2={yAxisEnd}
              stroke="#999"
              strokeWidth={0.5}
              strokeDasharray="4 4"
            />
            <text
              x={width / 2 - 40}
              y={height - 24}
              fontFamily="Arial, system-ui, sans-serif"
              fontSize={fontSize}
              fill="#333"
            >
              log₂ FC
            </text>
            <text
              x={24}
              y={height / 2}
              fontFamily="Arial, system-ui, sans-serif"
              fontSize={fontSize}
              fill="#333"
              transform={`rotate(-90 24 ${height / 2})`}
            >
              -log₁₀(p)
            </text>
            {volcanoData.map((p, i) => {
              const { x, y } = transformToCanvas(p.log2FC, p.negLog10P, bounds, width, height);
              const fill = p.isSignificant ? significantColor : nonsigColor;
              return (
                <circle
                  key={`${p.gene}-${i}`}
                  cx={x}
                  cy={y}
                  r={3}
                  fill={fill}
                />
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}
