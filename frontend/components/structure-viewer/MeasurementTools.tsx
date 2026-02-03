/**
 * PyMOL-Style Measurement Tools
 * 
 * Enables distance, angle, and dihedral measurements with visual indicators.
 * Click atoms to measure distances, angles, or torsions (just like PyMOL).
 */

"use client";

import { useState, useEffect, useCallback } from 'react';
import { Ruler, Triangle, Move3d, X } from 'lucide-react';
import * as NGL from 'ngl';

export type MeasurementMode = 'distance' | 'angle' | 'dihedral' | null;

interface Measurement {
  id: string;
  type: 'distance' | 'angle' | 'dihedral';
  atoms: Array<{
    atomIndex: number;
    resname: string;
    resno: number;
    chainname: string;
    atomname: string;
    x: number;
    y: number;
    z: number;
  }>;
  value: number;
  representation?: any; // NGL representation
}

interface MeasurementToolsProps {
  stage: any; // NGL.Stage
  component: any; // NGL.StructureComponent
  onMeasurementAdded?: (measurement: Measurement) => void;
}

export default function MeasurementTools({
  stage,
  component,
  onMeasurementAdded,
}: MeasurementToolsProps) {
  const [mode, setMode] = useState<MeasurementMode>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [selectedAtoms, setSelectedAtoms] = useState<any[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Calculate distance between two atoms
  const calculateDistance = useCallback((atom1: any, atom2: any): number => {
    const dx = atom1.x - atom2.x;
    const dy = atom1.y - atom2.y;
    const dz = atom1.z - atom2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }, []);

  // Calculate angle between three atoms (in degrees)
  const calculateAngle = useCallback((atom1: any, atom2: any, atom3: any): number => {
    // Vectors from atom2 to atom1 and atom3
    const v1 = {
      x: atom1.x - atom2.x,
      y: atom1.y - atom2.y,
      z: atom1.z - atom2.z,
    };
    const v2 = {
      x: atom3.x - atom2.x,
      y: atom3.y - atom2.y,
      z: atom3.z - atom2.z,
    };
    
    // Dot product and magnitudes
    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
    
    // Angle in radians, then convert to degrees
    const angleRad = Math.acos(dot / (mag1 * mag2));
    return (angleRad * 180) / Math.PI;
  }, []);

  // Calculate dihedral angle between four atoms (in degrees)
  const calculateDihedral = useCallback((atom1: any, atom2: any, atom3: any, atom4: any): number => {
    // Vectors
    const b1 = { x: atom2.x - atom1.x, y: atom2.y - atom1.y, z: atom2.z - atom1.z };
    const b2 = { x: atom3.x - atom2.x, y: atom3.y - atom2.y, z: atom3.z - atom2.z };
    const b3 = { x: atom4.x - atom3.x, y: atom4.y - atom3.y, z: atom4.z - atom3.z };
    
    // Cross products
    const n1 = {
      x: b1.y * b2.z - b1.z * b2.y,
      y: b1.z * b2.x - b1.x * b2.z,
      z: b1.x * b2.y - b1.y * b2.x,
    };
    const n2 = {
      x: b2.y * b3.z - b2.z * b3.y,
      y: b2.z * b3.x - b2.x * b3.z,
      z: b2.x * b3.y - b2.y * b3.x,
    };
    
    // Normalize
    const mag1 = Math.sqrt(n1.x * n1.x + n1.y * n1.y + n1.z * n1.z);
    const mag2 = Math.sqrt(n2.x * n2.x + n2.y * n2.y + n2.z * n2.z);
    n1.x /= mag1; n1.y /= mag1; n1.z /= mag1;
    n2.x /= mag2; n2.y /= mag2; n2.z /= mag2;
    
    // Dot product for angle
    const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
    let angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    
    // Determine sign
    const b2mag = Math.sqrt(b2.x * b2.x + b2.y * b2.y + b2.z * b2.z);
    const m = {
      x: n1.y * b2.z / b2mag - n1.z * b2.y / b2mag,
      y: n1.z * b2.x / b2mag - n1.x * b2.z / b2mag,
      z: n1.x * b2.y / b2mag - n1.y * b2.x / b2mag,
    };
    
    if (m.x * n2.x + m.y * n2.y + m.z * n2.z < 0) {
      angle = -angle;
    }
    
    return (angle * 180) / Math.PI;
  }, []);

  // Draw measurement visualization
  const drawMeasurement = useCallback((measurement: Measurement) => {
    if (!component) return;

    const { type, atoms } = measurement;

    try {
      if (type === 'distance' && atoms.length === 2) {
        // Draw distance line
        const repr = component.addRepresentation('distance', {
          atomPair: [[atoms[0].atomIndex, atoms[1].atomIndex]],
          color: 0xFFFF00, // Yellow (PyMOL style)
          labelSize: 2.0,
          labelColor: 0xFFFFFF,
          labelUnit: 'angstrom',
        });
        measurement.representation = repr;
      } else if (type === 'angle' && atoms.length === 3) {
        // Draw angle lines (two lines from center atom)
        const repr1 = component.addRepresentation('distance', {
          atomPair: [[atoms[0].atomIndex, atoms[1].atomIndex]],
          color: 0x00FFFF, // Cyan
          labelVisible: false,
        });
        const repr2 = component.addRepresentation('distance', {
          atomPair: [[atoms[1].atomIndex, atoms[2].atomIndex]],
          color: 0x00FFFF,
          labelVisible: false,
        });
        
        // Label at center atom
        const labelRepr = component.addRepresentation('label', {
          sele: `@${atoms[1].atomIndex}`,
          labelType: 'text',
          labelText: `${measurement.value.toFixed(1)}°`,
          color: 0xFFFFFF,
          fontSize: 14,
          backgroundColor: 0x000000,
          backgroundOpacity: 0.7,
        });
        
        measurement.representation = { repr1, repr2, labelRepr };
      } else if (type === 'dihedral' && atoms.length === 4) {
        // Draw dihedral lines (connecting all four atoms)
        component.addRepresentation('distance', {
          atomPair: [
            [atoms[0].atomIndex, atoms[1].atomIndex],
            [atoms[1].atomIndex, atoms[2].atomIndex],
            [atoms[2].atomIndex, atoms[3].atomIndex],
          ],
          color: 0xFF00FF, // Magenta
          labelVisible: false,
        });
        
        // Label at second atom
        component.addRepresentation('label', {
          sele: `@${atoms[1].atomIndex}`,
          labelType: 'text',
          labelText: `${measurement.value.toFixed(1)}°`,
          color: 0xFFFFFF,
          fontSize: 14,
        });
      }
    } catch (err) {
      console.error('Failed to draw measurement:', err);
    }
  }, [component]);

  // Handle atom click for measurement
  useEffect(() => {
    if (!stage || !component || !mode) return;

    const handleClick = (pickingProxy: any) => {
      if (!pickingProxy?.atom) return;

      const atom = pickingProxy.atom;
      const atomData = {
        atomIndex: atom.index,
        resname: atom.resname,
        resno: atom.resno,
        chainname: atom.chainname,
        atomname: atom.atomname,
        x: atom.x,
        y: atom.y,
        z: atom.z,
      };

      const newSelectedAtoms = [...selectedAtoms, atomData];
      setSelectedAtoms(newSelectedAtoms);

      // Determine required atom count
      const requiredCount = mode === 'distance' ? 2 : mode === 'angle' ? 3 : 4;

      // Update status message
      if (newSelectedAtoms.length < requiredCount) {
        setStatusMessage(
          `Select ${requiredCount - newSelectedAtoms.length} more atom(s) for ${mode}`
        );
      }

      // Complete measurement when enough atoms selected
      if (newSelectedAtoms.length === requiredCount) {
        let value = 0;
        
        if (mode === 'distance') {
          value = calculateDistance(newSelectedAtoms[0], newSelectedAtoms[1]);
        } else if (mode === 'angle') {
          value = calculateAngle(newSelectedAtoms[0], newSelectedAtoms[1], newSelectedAtoms[2]);
        } else if (mode === 'dihedral') {
          value = calculateDihedral(
            newSelectedAtoms[0],
            newSelectedAtoms[1],
            newSelectedAtoms[2],
            newSelectedAtoms[3]
          );
        }

        const measurement: Measurement = {
          id: `${mode}-${Date.now()}`,
          type: mode,
          atoms: newSelectedAtoms,
          value,
        };

        drawMeasurement(measurement);
        setMeasurements((prev) => [...prev, measurement]);
        onMeasurementAdded?.(measurement);

        // Reset
        setSelectedAtoms([]);
        setMode(null);
        setStatusMessage('');
      }
    };

    stage.signals.clicked.add(handleClick);

    return () => {
      stage.signals.clicked.remove(handleClick);
    };
  }, [
    stage,
    component,
    mode,
    selectedAtoms,
    calculateDistance,
    calculateAngle,
    calculateDihedral,
    drawMeasurement,
    onMeasurementAdded,
  ]);

  // Clear all measurements
  const clearMeasurements = useCallback(() => {
    measurements.forEach((m) => {
      if (m.representation) {
        if (typeof m.representation.remove === 'function') {
          m.representation.remove();
        } else if (m.representation.repr1) {
          m.representation.repr1.remove();
          m.representation.repr2.remove();
          m.representation.labelRepr.remove();
        }
      }
    });
    setMeasurements([]);
  }, [measurements]);

  // Delete single measurement
  const deleteMeasurement = useCallback((id: string) => {
    const measurement = measurements.find((m) => m.id === id);
    if (measurement?.representation) {
      if (typeof measurement.representation.remove === 'function') {
        measurement.representation.remove();
      } else if (measurement.representation.repr1) {
        measurement.representation.repr1.remove();
        measurement.representation.repr2.remove();
        measurement.representation.labelRepr?.remove();
      }
    }
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
  }, [measurements]);

  // Cancel current measurement
  const cancelMeasurement = useCallback(() => {
    setMode(null);
    setSelectedAtoms([]);
    setStatusMessage('');
  }, []);

  return (
    <div className="absolute top-4 right-4 z-20 bg-surface/95 backdrop-blur-sm border border-border rounded-xl shadow-card p-4 max-w-xs">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-serif font-semibold text-text-primary">Measurements</h3>
        {measurements.length > 0 && (
          <button
            onClick={clearMeasurements}
            className="text-xs text-text-tertiary hover:text-text-primary transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Measurement mode buttons */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <button
          onClick={() => {
            setMode(mode === 'distance' ? null : 'distance');
            setSelectedAtoms([]);
            setStatusMessage(mode === 'distance' ? '' : 'Select 2 atoms for distance');
          }}
          className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
            mode === 'distance'
              ? 'bg-accent/20 border-accent text-accent'
              : 'border-border hover:border-border-light text-text-secondary hover:text-text-primary'
          }`}
        >
          <Ruler className="w-4 h-4" />
          <span className="text-xs font-medium">Distance</span>
        </button>

        <button
          onClick={() => {
            setMode(mode === 'angle' ? null : 'angle');
            setSelectedAtoms([]);
            setStatusMessage(mode === 'angle' ? '' : 'Select 3 atoms for angle');
          }}
          className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
            mode === 'angle'
              ? 'bg-accent/20 border-accent text-accent'
              : 'border-border hover:border-border-light text-text-secondary hover:text-text-primary'
          }`}
        >
          <Triangle className="w-4 h-4" />
          <span className="text-xs font-medium">Angle</span>
        </button>

        <button
          onClick={() => {
            setMode(mode === 'dihedral' ? null : 'dihedral');
            setSelectedAtoms([]);
            setStatusMessage(mode === 'dihedral' ? '' : 'Select 4 atoms for dihedral');
          }}
          className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
            mode === 'dihedral'
              ? 'bg-accent/20 border-accent text-accent'
              : 'border-border hover:border-border-light text-text-secondary hover:text-text-primary'
          }`}
        >
          <Move3d className="w-4 h-4" />
          <span className="text-xs font-medium">Dihedral</span>
        </button>
      </div>

      {/* Status message */}
      {statusMessage && (
        <div className="mb-3 p-2 bg-accent/10 border border-accent/30 rounded-lg">
          <p className="text-xs text-text-primary">{statusMessage}</p>
          <p className="text-xs text-text-tertiary mt-1">
            Selected: {selectedAtoms.map((a) => `${a.resname}${a.resno}${a.chainname}`).join(', ')}
          </p>
          <button
            onClick={cancelMeasurement}
            className="text-xs text-accent hover:underline mt-1"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Measurement list */}
      {measurements.length > 0 && (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {measurements.map((m) => (
            <div
              key={m.id}
              className="flex items-start justify-between gap-2 p-2 bg-background/50 rounded-lg border border-border"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1 mb-1">
                  {m.type === 'distance' && <Ruler className="w-3 h-3 text-text-tertiary flex-shrink-0" />}
                  {m.type === 'angle' && <Triangle className="w-3 h-3 text-text-tertiary flex-shrink-0" />}
                  {m.type === 'dihedral' && <Move3d className="w-3 h-3 text-text-tertiary flex-shrink-0" />}
                  <span className="text-xs font-medium text-text-primary capitalize">{m.type}</span>
                </div>
                <p className="text-xs text-text-secondary truncate">
                  {m.atoms.map((a) => `${a.resname}${a.resno}${a.chainname}`).join(' - ')}
                </p>
                <p className="text-sm font-mono font-semibold text-accent mt-1">
                  {m.type === 'distance' ? `${m.value.toFixed(2)} Å` : `${m.value.toFixed(1)}°`}
                </p>
              </div>
              <button
                onClick={() => deleteMeasurement(m.id)}
                className="flex-shrink-0 p-1 hover:bg-surface rounded transition-colors"
              >
                <X className="w-3 h-3 text-text-tertiary hover:text-text-primary" />
              </button>
            </div>
          ))}
        </div>
      )}

      {measurements.length === 0 && !mode && (
        <p className="text-xs text-text-tertiary text-center py-3">
          Click a button above to start measuring
        </p>
      )}
    </div>
  );
}
