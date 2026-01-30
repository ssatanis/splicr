/**
 * Chart export utilities for publication-grade SVG, PNG, and interactive HTML.
 */

import { saveAs } from 'file-saver';
import html2canvas from 'html2canvas';

export async function exportElementAsPNG(element: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
  });
  canvas.toBlob((blob) => {
    if (blob) saveAs(blob, filename);
  }, 'image/png');
}

export function exportSVGAsFile(svg: SVGElement | null, filename: string): void {
  if (!svg) return;
  const serializer = new XMLSerializer();
  const str = serializer.serializeToString(svg);
  const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' });
  saveAs(blob, filename);
}

export function exportVolcanoAsInteractiveHTML(
  data: { gene: string; log2FC: number; negLog10P: number; fdr: number; isSignificant: boolean }[],
  filename: string,
  options?: { fdrThreshold?: number; lfcThreshold?: number }
): void {
  const fdr = options?.fdrThreshold ?? 0.05;
  const lfc = options?.lfcThreshold ?? 1;
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"><\/script>
  <style>
    body { font-family: system-ui, sans-serif; margin: 20px; background: #FAF8F5; }
    h1 { color: #1A1A1A; }
    .info { color: #6B6B6B; font-size: 14px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>Volcano Plot – SplicR Export</h1>
  <p class="info">Interactive plot. Drag to pan, scroll to zoom, hover for gene details. FDR &lt; ${fdr}, |Log₂FC| &gt; ${lfc}.</p>
  <div id="plot" style="width:100%;height:600px;"></div>
  <script>
    const data = ${JSON.stringify(data)};
    const trace = {
      x: data.map(d => d.log2FC),
      y: data.map(d => d.negLog10P),
      mode: 'markers',
      type: 'scatter',
      text: data.map(d => d.gene),
      customdata: data.map(d => [d.fdr]),
      hovertemplate: '<b>%{text}</b><br>Log₂ FC: %{x:.3f}<br>-Log₁₀(P): %{y:.3f}<br>FDR: %{customdata[0]:.4f}<extra></extra>',
      marker: {
        size: data.map(d => d.isSignificant ? 8 : 5),
        color: data.map(d => d.isSignificant ? '#6ABF36' : '#9B9B9B'),
        opacity: data.map(d => d.isSignificant ? 1 : 0.5),
      },
    };
    const layout = {
      title: 'Volcano Plot',
      xaxis: { title: 'Log₂ Fold Change', zeroline: true },
      yaxis: { title: '-Log₁₀(P-value)' },
      margin: { t: 50, r: 40, b: 60, l: 60 },
      showlegend: false,
      hovermode: 'closest',
    };
    const config = { responsive: true, displayModeBar: true, toImageButtonOptions: { format: 'png', filename: 'volcano' } };
    Plotly.newPlot('plot', [trace], layout, config);
  </script>
</body>
</html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  saveAs(blob, filename);
}

/**
 * Capture a container as PNG (for heatmap, time-course, etc.)
 */
export async function captureAndDownloadPNG(containerRef: React.RefObject<HTMLElement | null>, filename: string): Promise<void> {
  if (!containerRef?.current) return;
  await exportElementAsPNG(containerRef.current, filename);
}
