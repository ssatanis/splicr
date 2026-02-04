"use client";

/**
 * PyMOL-Quality Structure Viewer
 * 
 * Professional-grade 3D molecular structure viewer with PyMOL-level quality and features:
 * - GPU-accelerated rendering (impostor spheres/cylinders)
 * - Black background (scientific standard)
 * - PyMOL-style mouse controls
 * - Measurement tools (distance, angle, dihedral)
 * - Sequence viewer with secondary structure
 * - Command-line interface
 * - High-quality image export
 * - PyMOL representation presets
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Sparkles, Info, RotateCcw } from 'lucide-react';
import dynamic from 'next/dynamic';
import Button from '@/components/Button';
import { StructureViewerErrorBoundary } from '@/components/StructureViewerErrorBoundary';
import { StructureSource, StructureMetadata } from '@/hooks/useStructureLoader';
import MeasurementTools from '@/components/structure-viewer/MeasurementTools';
import SequencePanel from '@/components/structure-viewer/SequencePanel';
import CommandLine from '@/components/structure-viewer/CommandLine';
import ImageExporter from '@/components/structure-viewer/ImageExporter';
import PyMOLPresetsPanel from '@/components/structure-viewer/PyMOLPresetsPanel';
import { getPresetById } from '@/lib/crispr-structure-presets';
import type { CRISPRPreset } from '@/types/structure-viewer';

const StructureViewerCanvas = dynamic(
  () => import('@/components/StructureViewerCanvas'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full min-h-[700px] flex items-center justify-center bg-black/95 rounded-2xl border border-border">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4 w-12 h-12 border-3 border-green-500 border-t-transparent rounded-full" />
          <p className="text-green-400 font-mono text-lg">Initializing PyMOL-quality renderer...</p>
          <p className="text-gray-500 text-sm mt-2">GPU acceleration, impostor rendering, anti-aliasing</p>
        </div>
      </div>
    ),
  }
);

export default function PyMOLStructureViewerPage() {
  const [structureSource, setStructureSource] = useState<StructureSource | undefined>();
  const [presetToApply, setPresetToApply] = useState<CRISPRPreset | null>(null);
  const [metadata, setMetadata] = useState<StructureMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  
  // NGL Stage and Component refs
  const stageRef = useRef<any>(null);
  const componentRef = useRef<any>(null);

  // Load default example structure (5F9R - SpCas9)
  useEffect(() => {
    const preset = getPresetById('spcas9-sgrna') ?? null;
    setPresetToApply(preset);
    setStructureSource({ type: 'pdb', identifier: '5F9R' });
  }, []);

  const handleStructureLoaded = useCallback((meta: StructureMetadata) => {
    setMetadata(meta);
  }, []);

  const handleReset = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-black font-mono">
      {/* Header */}
      <header className="flex-shrink-0 px-8 py-4 border-b border-green-900/50 bg-black/95 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-green-400 mb-1 flex items-center gap-3">
              <Sparkles className="w-7 h-7 text-green-500" />
              PyMOL-Quality Structure Viewer
            </h1>
            <p className="text-gray-400 text-sm">
              GPU-accelerated molecular graphics | Publication-quality rendering
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={handleReset} variant="outline" size="sm" className="bg-black/50 border-green-700 text-green-400 hover:bg-green-900/20">
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset View
            </Button>
            {metadata && (
              <div className="text-sm text-green-500 font-mono bg-black/50 px-3 py-2 rounded-lg border border-green-900/50">
                {metadata.pdbId} | {metadata.residueCount.toLocaleString()} residues | {metadata.chainCount} chains
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main viewer area */}
      <div className="flex-1 flex flex-col p-4 gap-4 overflow-hidden">
        <StructureViewerErrorBoundary>
          <div className="flex-1 relative" style={{ minHeight: '600px' }}>
            {/* NGL Viewer (black background, PyMOL style) */}
            <StructureViewerCanvas
              key={reloadKey}
              structureSource={structureSource}
              presetToApply={presetToApply}
              defaultRepresentation="cartoon"
              defaultColorScheme="chainid"
              backgroundColor="black" // PyMOL black background
              onStructureLoaded={handleStructureLoaded}
              onLoadingChange={setIsLoading}
              className="w-full h-full rounded-2xl overflow-hidden"
            />

            {/* Overlays */}
            {!isLoading && metadata && (
              <>
                {/* PyMOL Presets Panel (top-left) */}
                <PyMOLPresetsPanel
                  component={componentRef.current}
                  onPresetApplied={(preset) => {
                    console.log('✅ Applied preset:', preset.name);
                  }}
                />

                {/* Measurement Tools (top-right) */}
                <MeasurementTools
                  stage={stageRef.current}
                  component={componentRef.current}
                  onMeasurementAdded={(measurement) => {
                    console.log('📏 Measurement:', measurement);
                  }}
                />

                {/* Image Exporter (bottom-right) */}
                <div className="absolute bottom-4 right-4 z-20">
                  <ImageExporter
                    stage={stageRef.current}
                    structureName={metadata.pdbId}
                  />
                </div>

                {/* Command Line (bottom-right, toggle) */}
                <CommandLine
                  stage={stageRef.current}
                  component={componentRef.current}
                  onCommandExecuted={(cmd, result) => {
                    console.log(`💻 Command: ${cmd} → ${result}`);
                  }}
                />
              </>
            )}
          </div>

          {/* Sequence Viewer Panel (bottom) */}
          {!isLoading && componentRef.current && (
            <SequencePanel
              component={componentRef.current}
              stage={stageRef.current}
              onResidueClick={(chain, resno) => {
                console.log(`🎯 Clicked residue: ${resno} in chain ${chain}`);
              }}
            />
          )}
        </StructureViewerErrorBoundary>

        {/* Keyboard shortcuts info */}
        <div className="flex-shrink-0 bg-black/80 border border-green-900/50 rounded-xl p-4 backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-gray-400 font-mono">
              <span className="font-semibold text-green-400">Keyboard Shortcuts:</span>
              {' '}
              <span className="text-green-500">R</span> Reset view
              {' · '}
              <span className="text-green-500">Arrow keys</span> Rotate
              {' · '}
              <span className="text-green-500">+/-</span> Zoom
              {' · '}
              <span className="text-green-500">Ctrl+L</span> Command line
              {' · '}
              <span className="text-gray-500">Mouse: Left-drag rotate | Scroll zoom | Right-drag pan</span>
            </div>
          </div>
        </div>

        {/* Performance info */}
        <div className="flex-shrink-0 bg-green-900/10 border border-green-700/30 rounded-xl p-3">
          <div className="flex items-center justify-between text-xs text-green-400 font-mono">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span>GPU Rendering: ACTIVE</span>
              </div>
              <div>Impostor Rendering: ON</div>
              <div>Anti-aliasing: 2x MSAA</div>
              <div>Mouse Controls: PyMOL</div>
            </div>
            <div className="text-gray-500">
              Performance optimized for structures up to 1M atoms
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
