import { useEffect, useRef, useState, useCallback } from 'react';
import * as NGL from 'ngl';

/**
 * Custom hook to manage NGL Stage lifecycle
 * Handles creation, resize, and cleanup of the WebGL-based molecular viewer
 * 
 * PYMOL-QUALITY CONFIGURATION:
 * - GPU-accelerated impostor rendering (5-10x faster than geometry-based)
 * - Black background (professional standard, better contrast)
 * - High-quality anti-aliasing (2x MSAA)
 * - PyMOL-style mouse controls
 * - Optimized lighting for publication-quality visuals
 */
export function useNGLStage(backgroundColor: string = 'black') {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<NGL.Stage | null>(null);
  const [stage, setStage] = useState<NGL.Stage | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Initialize NGL Stage — stage in state so consumers re-render when ready
  useEffect(() => {
    // Ensure container exists
    if (!containerRef.current) {
      console.warn('NGL Stage: Container ref not ready');
      return;
    }

    // Use ResizeObserver to wait for container to have dimensions
    let stageInstance: NGL.Stage | null = null;
    let resizeTimeout: NodeJS.Timeout;
    let cleanedUp = false;

    const initializeStage = () => {
      if (!containerRef.current || cleanedUp) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.warn('NGL Stage: Container has no dimensions, waiting...');
        return;
      }

      // Check WebGL support before initializing
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) {
          throw new Error('WebGL is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Safari.');
        }
        console.log('✅ WebGL is supported');
      } catch (webglErr) {
        setError(webglErr as Error);
        console.error('❌ WebGL check failed:', webglErr);
        return;
      }

      try {
        console.log('🔬 Initializing high-performance molecular graphics renderer:', rect.width, 'x', rect.height);

        // RESEARCH-GRADE STAGE CONFIGURATION
        // GPU-accelerated WebGL rendering with publication-quality visual fidelity
        stageInstance = new NGL.Stage(containerRef.current, {
          // PERFORMANCE SETTINGS (PyMOL v1.5+ GPU rendering)
          backgroundColor, // Black background (PyMOL default, better contrast)
          quality: 'high', // High-quality geometry
          sampleLevel: 2, // 2x anti-aliasing (smooth edges)
          impostor: true, // GPU-accelerated sphere/cylinder rendering (CRITICAL: 5-10x faster)
          workerDefault: true, // Use web workers for parsing (non-blocking)
          
          // LIGHTING (match PyMOL's professional lighting)
          lightColor: 0xffffff, // White light
          lightIntensity: 1.2, // Slightly brighter than default
          ambientColor: 0x222222, // Soft ambient (like PyMOL)
          ambientIntensity: 0.3, // Subtle ambient glow
          
          // CAMERA & CLIPPING (smooth depth perception)
          cameraType: 'perspective', // NOT orthographic (PyMOL uses perspective)
          clipNear: 0, // Don't clip nearby geometry
          clipFar: 100,
          clipDist: 10,
          fogNear: 50,
          fogFar: 100,
          
          // MOUSE CONTROLS (PyMOL-style)
          mousePreset: 'pymol' as any, // Use PyMOL-style controls
        });

        // Additional smooth camera settings
        stageInstance.setParameters({
          cameraFov: 40, // Field of view (matches PyMOL default)
          clipDist: 'auto' as any, // Auto-adjust clipping
        });

        // CRITICAL FIX: Force canvas to be visible and properly sized
        const canvas = stageInstance.viewer.renderer.domElement;
        if (canvas) {
          console.log('🔧 Configuring canvas element...');
          canvas.style.display = 'block';
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          canvas.style.position = 'absolute';
          canvas.style.top = '0';
          canvas.style.left = '0';
          console.log('✅ Canvas configured:', canvas.width, 'x', canvas.height);
        }

        // Force initial resize and render
        stageInstance.handleResize();
        stageInstance.viewer.requestRender();

        stageRef.current = stageInstance;
        setStage(stageInstance);
        setIsReady(true);
        
        console.log('✅ Molecular visualization engine initialized');
        console.log('   - Hardware-accelerated GPU rendering: ACTIVE');
        console.log('   - Multisample anti-aliasing (MSAA): 2x');
        console.log('   - Interactive manipulation controls: ENABLED');
        console.log('   - WebGL canvas: ', canvas ? `${canvas.width}x${canvas.height}` : 'ERROR');
      } catch (err) {
        setError(err as Error);
        console.error('❌ Failed to initialize NGL Stage:', err);
        console.error('   - Error details:', err);
      }
    };

    // Try immediate initialization
    const immediateCheck = setTimeout(initializeStage, 100);

    // Also set up ResizeObserver as fallback
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0 && !stageInstance) {
          initializeStage();
        }
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (stageRef.current) {
          stageRef.current.handleResize();
        }
      }, 150);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cleanedUp = true;
      clearTimeout(immediateCheck);
      clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      if (stageRef.current) {
        stageRef.current.dispose();
        stageRef.current = null;
      }
      setStage(null);
      setIsReady(false);
    };
  }, [backgroundColor]);

  // Center and auto-view
  const centerView = useCallback(() => {
    if (stageRef.current) {
      stageRef.current.autoView();
    }
  }, []);

  // Reset camera
  const resetCamera = useCallback(() => {
    if (stageRef.current) {
      stageRef.current.autoView(1000); // 1 second animation
    }
  }, []);

  // Clear all components from stage
  const clearStage = useCallback(() => {
    if (stageRef.current) {
      stageRef.current.removeAllComponents();
    }
  }, []);

  return {
    containerRef,
    stage,
    stageRef,
    isReady,
    error,
    centerView,
    resetCamera,
    clearStage,
  };
}
