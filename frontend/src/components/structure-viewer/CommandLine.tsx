/**
 * PyMOL-Style Command-Line Interface
 * 
 * Execute PyMOL-style commands for power users.
 * Commands: show cartoon, hide everything, color blue, select resi 100-120, zoom resi 50, etc.
 */

"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal, ChevronRight, History, X } from 'lucide-react';
import { PYMOL_PRESETS, pymolToNGLSelection } from '@/lib/pymol-presets';

interface CommandLineProps {
  stage: any; // NGL.Stage
  component: any; // NGL.StructureComponent
  onCommandExecuted?: (command: string, result: string) => void;
}

interface CommandHistoryItem {
  command: string;
  result: string;
  timestamp: Date;
  success: boolean;
}

export default function CommandLine({ stage, component, onCommandExecuted }: CommandLineProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<CommandHistoryItem[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // PyMOL command parser and executor
  const executeCommand = useCallback(
    (cmd: string) => {
      if (!stage || !component) {
        return { success: false, message: 'Stage or component not ready' };
      }

      const parts = cmd.trim().toLowerCase().split(/\s+/);
      if (parts.length === 0) {
        return { success: false, message: 'Empty command' };
      }

      const action = parts[0];

      try {
        // ═══════════════════════════════════════════════════════════════════════════════
        // SHOW COMMAND
        // ═══════════════════════════════════════════════════════════════════════════════
        if (action === 'show') {
          const representation = parts[1];
          const selection = parts.slice(2).join(' ');

          if (representation === 'cartoon') {
            component.addRepresentation('cartoon', {
              sele: selection || 'all',
              colorScheme: 'chainid',
              quality: 'high',
            });
            return { success: true, message: `Showing cartoon${selection ? ` for ${selection}` : ''}` };
          } else if (representation === 'sticks') {
            component.addRepresentation('licorice', {
              sele: selection || 'all',
              colorScheme: 'element',
              radiusScale: 0.3,
            });
            return { success: true, message: `Showing sticks${selection ? ` for ${selection}` : ''}` };
          } else if (representation === 'surface') {
            component.addRepresentation('surface', {
              sele: selection || 'protein',
              colorScheme: 'chainid',
              opacity: 0.85,
            });
            return { success: true, message: `Showing surface${selection ? ` for ${selection}` : ''}` };
          } else if (representation === 'spheres') {
            component.addRepresentation('spacefill', {
              sele: selection || 'all',
              colorScheme: 'element',
            });
            return { success: true, message: `Showing spheres${selection ? ` for ${selection}` : ''}` };
          } else if (representation === 'ribbon') {
            component.addRepresentation('ribbon', {
              sele: selection || 'all',
              colorScheme: 'sstruc',
            });
            return { success: true, message: `Showing ribbon${selection ? ` for ${selection}` : ''}` };
          }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        // HIDE COMMAND
        // ═══════════════════════════════════════════════════════════════════════════════
        if (action === 'hide') {
          if (parts[1] === 'everything' || parts[1] === 'all') {
            component.removeAllRepresentations();
            return { success: true, message: 'Hidden all representations' };
          }
          // Hide specific representation (remove last added)
          const reprs = component.reprList;
          if (reprs.length > 0) {
            reprs[reprs.length - 1].dispose();
            return { success: true, message: 'Hidden last representation' };
          }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        // COLOR COMMAND
        // ═══════════════════════════════════════════════════════════════════════════════
        if (action === 'color') {
          const colorName = parts[1];
          const selection = parts.slice(2).join(' ');

          const colorMap: Record<string, number> = {
            red: 0xFF0000,
            blue: 0x0000FF,
            green: 0x00FF00,
            yellow: 0xFFFF00,
            cyan: 0x00FFFF,
            magenta: 0xFF00FF,
            white: 0xFFFFFF,
            gray: 0x888888,
            orange: 0xFF9900,
            purple: 0x9900FF,
          };

          const color = colorMap[colorName];
          if (!color) {
            return { success: false, message: `Unknown color: ${colorName}` };
          }

          component.removeAllRepresentations();
          component.addRepresentation('cartoon', {
            sele: selection || 'all',
            color,
            quality: 'high',
          });
          return { success: true, message: `Colored ${selection || 'all'} ${colorName}` };
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        // SELECT COMMAND
        // ═══════════════════════════════════════════════════════════════════════════════
        if (action === 'select') {
          const pymolSelection = parts.slice(1).join(' ');
          const nglSelection = pymolToNGLSelection(pymolSelection);

          component.addRepresentation('ball+stick', {
            sele: nglSelection,
            color: 0xFFFF00, // Yellow
            radiusScale: 1.5,
          });
          return { success: true, message: `Selected: ${pymolSelection}` };
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        // ZOOM COMMAND
        // ═══════════════════════════════════════════════════════════════════════════════
        if (action === 'zoom') {
          const pymolSelection = parts.slice(1).join(' ');
          const nglSelection = pymolToNGLSelection(pymolSelection);

          const center = component.getCenter(nglSelection || 'all');
          if (center) {
            stage.animationControls.zoomMove(center, 0, 500);
            return { success: true, message: `Zoomed to: ${pymolSelection || 'all'}` };
          }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        // RESET COMMAND
        // ═══════════════════════════════════════════════════════════════════════════════
        if (action === 'reset' || action === 'center') {
          stage.autoView(1000);
          return { success: true, message: 'Reset view' };
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        // PRESET COMMAND
        // ═══════════════════════════════════════════════════════════════════════════════
        if (action === 'preset') {
          const presetName = parts[1];
          const preset = PYMOL_PRESETS.find(
            (p) => p.id === presetName || p.name.toLowerCase().includes(presetName)
          );

          if (preset) {
            preset.apply(component);
            return { success: true, message: `Applied preset: ${preset.name}` };
          }
          return { success: false, message: `Unknown preset: ${presetName}` };
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        // BG (BACKGROUND) COMMAND
        // ═══════════════════════════════════════════════════════════════════════════════
        if (action === 'bg' || action === 'background') {
          const color = parts[1];
          if (color === 'black') {
            stage.setParameters({ backgroundColor: 'black' });
            return { success: true, message: 'Background: black' };
          } else if (color === 'white') {
            stage.setParameters({ backgroundColor: 'white' });
            return { success: true, message: 'Background: white' };
          }
        }

        // ═══════════════════════════════════════════════════════════════════════════════
        // HELP COMMAND
        // ═══════════════════════════════════════════════════════════════════════════════
        if (action === 'help') {
          return {
            success: true,
            message: `Available commands:
• show [cartoon|sticks|surface|spheres|ribbon] [selection]
• hide [everything|all]
• color [red|blue|green|yellow|cyan|magenta|white|gray|orange|purple] [selection]
• select resi 100-120 | chain A
• zoom [selection]
• reset / center
• preset [cartoon|sticks|surface|ribbon-ligand]
• bg [black|white]
• help`,
          };
        }

        return { success: false, message: `Unknown command: ${action}. Type "help" for available commands.` };
      } catch (error) {
        return { success: false, message: `Error: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
    [stage, component]
  );

  // Handle command submission
  const handleSubmit = useCallback(() => {
    if (!input.trim()) return;

    const result = executeCommand(input);
    const historyItem: CommandHistoryItem = {
      command: input,
      result: result.message,
      timestamp: new Date(),
      success: result.success,
    };

    setHistory((prev) => [historyItem, ...prev].slice(0, 50)); // Keep last 50 commands
    setInput('');
    setHistoryIndex(-1);

    onCommandExecuted?.(input, result.message);
  }, [input, executeCommand, onCommandExecuted]);

  // Handle keyboard navigation (arrow keys for history, Ctrl+L to toggle)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        if (history[newIndex]) {
          setInput(history[newIndex].command);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const newIndex = Math.max(historyIndex - 1, -1);
        setHistoryIndex(newIndex);
        if (newIndex === -1) {
          setInput('');
        } else if (history[newIndex]) {
          setInput(history[newIndex].command);
        }
      } else if (e.key === 'Escape') {
        setIsOpen(false);
      }
    },
    [handleSubmit, history, historyIndex]
  );

  // Global keyboard shortcut: Ctrl+L or Cmd+L
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-20 flex items-center gap-2 px-4 py-2 bg-surface/95 backdrop-blur-sm border border-border rounded-xl shadow-card hover:shadow-lg transition-all text-text-primary hover:text-accent"
        title="Open command line (Ctrl+L)"
      >
        <Terminal className="w-4 h-4" />
        <span className="text-sm font-mono">Command Line</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-20 w-96 bg-surface/98 backdrop-blur-md border border-border rounded-xl shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background/50">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-accent" />
          <span className="text-sm font-mono font-semibold text-text-primary">PyMOL Commands</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="p-1 hover:bg-surface rounded transition-colors"
            title="Command history"
          >
            <History className="w-4 h-4 text-text-tertiary hover:text-text-primary" />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-surface rounded transition-colors"
          >
            <X className="w-4 h-4 text-text-tertiary hover:text-text-primary" />
          </button>
        </div>
      </div>

      {/* Command history */}
      {showHistory && history.length > 0 && (
        <div className="max-h-48 overflow-y-auto border-b border-border bg-background/30">
          {history.map((item, index) => (
            <button
              key={index}
              onClick={() => {
                setInput(item.command);
                setShowHistory(false);
                inputRef.current?.focus();
              }}
              className="w-full flex items-start gap-2 px-4 py-2 hover:bg-surface/50 transition-colors text-left border-b border-border/50 last:border-b-0"
            >
              <ChevronRight
                className={`w-3 h-3 mt-0.5 flex-shrink-0 ${
                  item.success ? 'text-green-500' : 'text-red-500'
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-text-primary truncate">{item.command}</div>
                <div
                  className={`text-[10px] text-text-tertiary truncate ${
                    item.success ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {item.result}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2 px-4 py-3">
        <ChevronRight className="w-4 h-4 text-accent flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder='Type "help" for commands...'
          className="flex-1 bg-transparent text-sm font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none"
        />
      </div>

      {/* Last result */}
      {history.length > 0 && (
        <div className="px-4 py-2 border-t border-border bg-background/30">
          <div
            className={`text-xs font-mono ${
              history[0].success ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {history[0].result}
          </div>
        </div>
      )}

      {/* Keyboard shortcuts */}
      <div className="px-4 py-2 border-t border-border bg-background/50 text-[10px] text-text-tertiary font-mono">
        <span className="opacity-75">↑↓ History</span>
        <span className="mx-2 opacity-50">•</span>
        <span className="opacity-75">Enter Submit</span>
        <span className="mx-2 opacity-50">•</span>
        <span className="opacity-75">Esc Close</span>
        <span className="mx-2 opacity-50">•</span>
        <span className="opacity-75">Ctrl+L Toggle</span>
      </div>
    </div>
  );
}
