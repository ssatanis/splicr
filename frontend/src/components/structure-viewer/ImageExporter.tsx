/**
 * PyMOL-Style High-Quality Image Export
 * 
 * Export publication-quality images with anti-aliasing (PyMOL ray equivalent).
 * Supports multiple resolutions and transparent backgrounds.
 */

"use client";

import { useState, useCallback } from 'react';
import { Camera, Download, Settings, X } from 'lucide-react';

interface ImageExporterProps {
  stage: any; // NGL.Stage
  structureName?: string;
}

type Resolution = '1x' | '2x' | '4x' | '8x';
type Format = 'png' | 'jpg';

export default function ImageExporter({ stage, structureName = 'structure' }: ImageExporterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [resolution, setResolution] = useState<Resolution>('4x');
  const [format, setFormat] = useState<Format>('png');
  const [transparent, setTransparent] = useState(false);
  const [antiAlias, setAntiAlias] = useState(true);

  /**
   * Export high-quality image (PyMOL ray equivalent)
   */
  const exportImage = useCallback(async () => {
    if (!stage) {
      alert('Stage not ready');
      return;
    }

    setIsExporting(true);

    try {
      // Get resolution multiplier
      const factorMap: Record<Resolution, number> = {
        '1x': 1,
        '2x': 2,
        '4x': 4,
        '8x': 8,
      };
      const factor = factorMap[resolution];

      // Store current settings
      const originalSampleLevel = stage.viewer.sampleLevel;

      // Temporarily increase quality for export
      if (antiAlias) {
        stage.viewer.setParameters({
          sampleLevel: 4, // 4x anti-aliasing for export
        });
      }

      // Render at high resolution
      const imageDataUrl = await stage.makeImage({
        factor, // Resolution multiplier (e.g., 4x = 4 times larger)
        antialias: antiAlias,
        trim: false, // Don't trim whitespace
        transparent, // Transparent background
      });

      // Convert to desired format if needed
      let finalDataUrl = imageDataUrl;
      if (format === 'jpg' && imageDataUrl.startsWith('data:image/png')) {
        // Convert PNG to JPG
        const img = new Image();
        img.src = imageDataUrl;
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Fill white background for JPG
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);
          finalDataUrl = canvas.toDataURL('image/jpeg', 0.95);
        }
      }

      // Download image
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      link.href = finalDataUrl;
      link.download = `${structureName}_${resolution}_${timestamp}.${format}`;
      link.click();

      // Restore original quality
      stage.viewer.setParameters({
        sampleLevel: originalSampleLevel,
      });

      setIsOpen(false);
    } catch (error) {
      console.error('Failed to export image:', error);
      alert('Failed to export image. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [stage, resolution, format, transparent, antiAlias, structureName]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-2 bg-surface/95 backdrop-blur-sm border border-border rounded-xl shadow-card hover:shadow-lg transition-all text-text-primary hover:text-accent"
        title="Export high-quality image"
      >
        <Camera className="w-4 h-4" />
        <span className="text-sm font-medium">Export Image</span>
      </button>
    );
  }

  return (
    <div className="bg-surface/98 backdrop-blur-md border border-border rounded-xl shadow-2xl p-4 w-80">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-accent" />
          <h3 className="text-sm font-serif font-semibold text-text-primary">Export Image</h3>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 hover:bg-background rounded transition-colors"
        >
          <X className="w-4 h-4 text-text-tertiary hover:text-text-primary" />
        </button>
      </div>

      {/* Resolution */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">
          Resolution
        </label>
        <div className="grid grid-cols-4 gap-2">
          {(['1x', '2x', '4x', '8x'] as Resolution[]).map((res) => (
            <button
              key={res}
              onClick={() => setResolution(res)}
              className={`px-3 py-2 text-sm font-mono rounded-lg border transition-colors ${
                resolution === res
                  ? 'bg-accent/20 border-accent text-accent'
                  : 'border-border hover:border-border-light text-text-secondary hover:text-text-primary'
              }`}
            >
              {res}
            </button>
          ))}
        </div>
        <p className="text-xs text-text-tertiary mt-1">
          {resolution === '1x' && 'Current size (~1920px)'}
          {resolution === '2x' && 'Double size (~3840px)'}
          {resolution === '4x' && 'Quad size (~7680px) - Recommended'}
          {resolution === '8x' && 'Ultra size (~15360px) - Publication'}
        </p>
      </div>

      {/* Format */}
      <div className="mb-4">
        <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">
          Format
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setFormat('png')}
            className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              format === 'png'
                ? 'bg-accent/20 border-accent text-accent'
                : 'border-border hover:border-border-light text-text-secondary hover:text-text-primary'
            }`}
          >
            PNG
          </button>
          <button
            onClick={() => setFormat('jpg')}
            className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
              format === 'jpg'
                ? 'bg-accent/20 border-accent text-accent'
                : 'border-border hover:border-border-light text-text-secondary hover:text-text-primary'
            }`}
          >
            JPG
          </button>
        </div>
      </div>

      {/* Options */}
      <div className="mb-4 space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={antiAlias}
            onChange={(e) => setAntiAlias(e.target.checked)}
            className="w-4 h-4 rounded border-border text-accent focus:ring-accent"
          />
          <span className="text-sm text-text-primary">Anti-aliasing (4x MSAA)</span>
        </label>

        {format === 'png' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={transparent}
              onChange={(e) => setTransparent(e.target.checked)}
              className="w-4 h-4 rounded border-border text-accent focus:ring-accent"
            />
            <span className="text-sm text-text-primary">Transparent background</span>
          </label>
        )}
      </div>

      {/* Export button */}
      <button
        onClick={exportImage}
        disabled={isExporting}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isExporting ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span>Exporting...</span>
          </>
        ) : (
          <>
            <Download className="w-4 h-4" />
            <span>Export High-Quality Image</span>
          </>
        )}
      </button>

      {/* Info */}
      <div className="mt-3 p-2 bg-accent/10 border border-accent/30 rounded-lg">
        <p className="text-xs text-text-secondary">
          💡 <strong>Tip:</strong> 4x resolution with anti-aliasing produces publication-quality images
          similar to PyMOL's ray-traced output.
        </p>
      </div>
    </div>
  );
}
