'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { GripVertical, ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AIPanel } from './panels/AIPanel';
import type { PDBMetadataForAI } from '@/types/ai.types';

interface ResizableAIPanelProps {
  currentStructure: string;
  metadata: PDBMetadataForAI | null;
}

const MIN_WIDTH = 320;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 400;

export function ResizableAIPanel({ currentStructure, metadata }: ResizableAIPanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return;

      const panelRect = panelRef.current.getBoundingClientRect();
      const newWidth = panelRect.right - e.clientX;
      
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setWidth(newWidth);
      }
    },
    [isResizing]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return (
    <div
      ref={panelRef}
      className={cn(
        'relative h-full flex-shrink-0 transition-all duration-300 ease-in-out',
        isCollapsed ? 'w-12' : ''
      )}
      style={{ width: isCollapsed ? '48px' : `${width}px` }}
    >
      {/* Resize Handle */}
      {!isCollapsed && (
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            'absolute left-0 top-0 bottom-0 w-1 cursor-col-resize group hover:bg-accent/20 transition-colors z-10',
            isResizing && 'bg-accent/30'
          )}
        >
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
            <GripVertical className="w-4 h-4 text-accent" />
          </div>
        </div>
      )}

      {/* Collapse/Expand Button */}
      <button
        onClick={toggleCollapse}
        className={cn(
          'absolute top-1/2 -translate-y-1/2 z-20 bg-surface border border-border rounded-full p-1.5 hover:bg-accent/10 transition-all shadow-md',
          isCollapsed ? 'left-1/2 -translate-x-1/2' : 'left-3'
        )}
        title={isCollapsed ? 'Expand AI Assistant' : 'Collapse AI Assistant'}
      >
        {isCollapsed ? (
          <ChevronLeft className="w-4 h-4 text-text-secondary" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-secondary" />
        )}
      </button>

      {/* Collapsed State */}
      {isCollapsed && (
        <div className="h-full flex items-center justify-center bg-surface border-l border-border">
          <div 
            className="text-sm font-serif text-text-tertiary tracking-wider"
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
          >
            AI Assistant
          </div>
        </div>
      )}

      {/* Expanded State - AI Panel */}
      {!isCollapsed && (
        <div className="h-full overflow-hidden">
          <AIPanel currentStructure={currentStructure} metadata={metadata} />
        </div>
      )}
    </div>
  );
}
