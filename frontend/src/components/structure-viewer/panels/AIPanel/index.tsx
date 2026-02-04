'use client';

import { useState } from 'react';
import { MessageSquare, BookOpen, Wand2, Pill } from 'lucide-react';
import { GeminiChat } from './GeminiChat';
import { StructureExplainer } from './StructureExplainer';
import { MutationPredictor } from './MutationPredictor';
import { DrugTargetAnalyzer } from './DrugTargetAnalyzer';
import type { AIPanelTab, PDBMetadataForAI } from '@/types/ai.types';
import { cn } from '@/lib/utils';

interface AIPanelProps {
  currentStructure: string;
  metadata: PDBMetadataForAI | null;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3 py-2 text-xs font-serif rounded-lg transition-all duration-200',
        active
          ? 'bg-accent/10 text-accent font-medium shadow-sm'
          : 'text-text-tertiary hover:text-text-secondary hover:bg-background'
      )}
    >
      {children}
    </button>
  );
}

export function AIPanel({ currentStructure, metadata }: AIPanelProps) {
  const [activeTab, setActiveTab] = useState<AIPanelTab>('chat');

  const hasValidStructure =
    currentStructure &&
    currentStructure !== 'Upload' &&
    currentStructure.length >= 4;

  return (
    <div className="h-full flex flex-col bg-white/95 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-border/50">
        <h2 className="text-lg font-serif font-semibold text-text-primary flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
          AI Structure Assistant
        </h2>
        <p className="text-xs text-text-tertiary mt-1 font-serif">
          {hasValidStructure ? `Analyzing ${currentStructure}` : 'Load a structure to begin'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 px-4 pt-3 border-b border-border/50 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          <TabButton
            active={activeTab === 'chat'}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Ask Gemini</span>
          </TabButton>
          <TabButton
            active={activeTab === 'explain'}
            onClick={() => setActiveTab('explain')}
          >
            <BookOpen className="w-4 h-4" />
            <span>Explain</span>
          </TabButton>
          <TabButton
            active={activeTab === 'mutate'}
            onClick={() => setActiveTab('mutate')}
          >
            <Wand2 className="w-4 h-4" />
            <span>Mutations</span>
          </TabButton>
          <TabButton
            active={activeTab === 'drug'}
            onClick={() => setActiveTab('drug')}
          >
            <Pill className="w-4 h-4" />
            <span>Druggability</span>
          </TabButton>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 min-h-0">
        {!hasValidStructure ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mb-4">
              <MessageSquare className="w-10 h-10 text-accent/40" />
            </div>
            <p className="text-sm text-text-secondary font-serif font-medium mb-2">
              No Structure Loaded
            </p>
            <p className="text-xs text-text-tertiary font-serif max-w-[240px]">
              Select a CRISPR preset from the right panel or upload your own PDB/CIF file to start analyzing
            </p>
          </div>
        ) : (
          <>
            {activeTab === 'chat' && (
              <GeminiChat structureContext={currentStructure} />
            )}
            {activeTab === 'explain' && (
              <StructureExplainer pdbId={currentStructure} metadata={metadata} />
            )}
            {activeTab === 'mutate' && (
              <MutationPredictor pdbId={currentStructure} />
            )}
            {activeTab === 'drug' && (
              <DrugTargetAnalyzer pdbId={currentStructure} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
