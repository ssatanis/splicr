"use client";

import { Environment, Float, Lightformer } from "@react-three/drei";
import { Canvas, type CanvasProps } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";

import { cn } from "@/lib/utils";

import {
  CoilCurve,
  buildMolecule,
  circleProfile,
  extrudeProfile,
  randomSpine,
  roundedRectProfile,
  waveSpine,
} from "./geometry";

export const ORANGE = "#f87315";
export const ORANGE_DEEP = "#e5650c";
export const CYAN = "#07b6d3";
export const TEAL = "#174f62";

/* ------------------------------------------------------------------ */
/* Canvas wrapper: pauses rendering when scrolled out of view.          */
/* ------------------------------------------------------------------ */
type SceneProps = {
  children: React.ReactNode;
  className?: string;
  camera?: CanvasProps["camera"];
  dpr?: CanvasProps["dpr"];
};

export function Scene({
  children,
  className,
  camera = { position: [0, 0, 12], fov: 32 },
  dpr = [1, 1.75],
}: SceneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: "120px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("pointer-events-none", className)} aria-hidden>
      <Canvas
        flat
        frameloop={visible ? "always" : "never"}
        dpr={dpr}
        camera={camera}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ background: "transparent" }}
      >
        {children}
      </Canvas>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Studio lighting with a procedural environment (no downloads).       */
/* ------------------------------------------------------------------ */
export function Studio({ intensity = 1 }: { intensity?: number }) {
  return (
    <>
      <ambientLight intensity={0.9 * intensity} />
      <hemisphereLight args={["#ffffff", "#dfe8ec", 0.8 * intensity]} />
      <directionalLight position={[6, 10, 6]} intensity={2.6 * intensity} />
      <directionalLight position={[-8, -3, -5]} intensity={1.1 * intensity} color="#e8f7fa" />
      <directionalLight position={[0, -6, 8]} intensity={0.7 * intensity} color="#fff1e4" />
      <Environment resolution={256} frames={1}>
        <Lightformer
          intensity={2.6}
          position={[0, 6, -6]}
          rotation-x={Math.PI / 2}
          scale={[12, 12, 1]}
          color="white"
        />
        <Lightformer
          intensity={1.3}
          position={[-7, 2, 4]}
          rotation-y={Math.PI / 2}
          scale={[7, 3, 1]}
          color="#fff6ea"
        />
        <Lightformer
          intensity={0.9}
          position={[7, -2, 4]}
          rotation-y={-Math.PI / 2}
          scale={[7, 3, 1]}
          color="#dff7fb"
        />
      </Environment>
    </>
  );
}

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia(motionQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(motionQuery).matches,
    () => false,
  );
}

/** Gentle float; respects prefers-reduced-motion. */
export function Drift({
  children,
  speed = 1,
  rotation = 0.35,
  float = 0.6,
}: {
  children: React.ReactNode;
  speed?: number;
  rotation?: number;
  float?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <Float
      speed={reduced ? 0 : speed}
      rotationIntensity={reduced ? 0 : rotation}
      floatIntensity={reduced ? 0 : float}
    >
      {children}
    </Float>
  );
}

/* ------------------------------------------------------------------ */
/* Materials                                                            */
/* ------------------------------------------------------------------ */
function Glossy({ color }: { color: string }) {
  return (
    <meshPhysicalMaterial
      color={color}
      roughness={0.3}
      metalness={0}
      clearcoat={0.85}
      clearcoatRoughness={0.22}
      envMapIntensity={1.15}
      side={THREE.DoubleSide}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Shapes                                                               */
/* ------------------------------------------------------------------ */
type Placement = {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
};

export function CoilRibbon({
  seed = 1,
  radius = 0.55,
  turns = 7,
  width = 0.44,
  thickness = 0.065,
  segments = 720,
  points = 5,
  spread = [3, 1.6, 1.2] as [number, number, number],
  color = ORANGE,
  ...placement
}: Placement & {
  seed?: number;
  radius?: number;
  turns?: number;
  width?: number;
  thickness?: number;
  segments?: number;
  points?: number;
  spread?: [number, number, number];
  color?: string;
}) {
  const geometry = useMemo(() => {
    const spine = randomSpine(seed, points, spread);
    const curve = new CoilCurve(spine, radius, turns);
    return extrudeProfile(curve, roundedRectProfile(thickness, width), segments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, radius, turns, width, thickness, segments, points, spread[0], spread[1], spread[2]]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} {...placement}>
      <Glossy color={color} />
    </mesh>
  );
}

export function SmoothTube({
  seed = 7,
  radius = 0.11,
  points = 6,
  spread = [2.6, 1.8, 1.2] as [number, number, number],
  color = CYAN,
  ...placement
}: Placement & {
  seed?: number;
  radius?: number;
  points?: number;
  spread?: [number, number, number];
  color?: string;
}) {
  const geometry = useMemo(() => {
    const spine = randomSpine(seed, points, spread);
    return extrudeProfile(spine, circleProfile(radius, 18), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, radius, points, spread[0], spread[1], spread[2]]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} {...placement}>
      <Glossy color={color} />
    </mesh>
  );
}

export function TwistRibbon({
  length = 14,
  amplitude = 0.9,
  waves = 2.2,
  phase = 0,
  z = 0,
  width = 0.9,
  thickness = 0.05,
  twist = Math.PI * 3,
  color = ORANGE,
  ...placement
}: Placement & {
  length?: number;
  amplitude?: number;
  waves?: number;
  phase?: number;
  z?: number;
  width?: number;
  thickness?: number;
  twist?: number;
  color?: string;
}) {
  const geometry = useMemo(() => {
    const spine = waveSpine(length, amplitude, waves, phase, z);
    return extrudeProfile(spine, roundedRectProfile(thickness, width), 520, twist);
  }, [length, amplitude, waves, phase, z, width, thickness, twist]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} {...placement}>
      <Glossy color={color} />
    </mesh>
  );
}

export function Molecule({
  seed = 3,
  rings = 6,
  atomRadius = 0.27,
  bondRadius = 0.085,
  color = ORANGE,
  ...placement
}: Placement & {
  seed?: number;
  rings?: number;
  atomRadius?: number;
  bondRadius?: number;
  color?: string;
}) {
  const { atoms, bonds } = useMemo(() => buildMolecule(seed, rings), [seed, rings]);
  const atomRef = useRef<THREE.InstancedMesh>(null);
  const bondRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const s = new THREE.Vector3();
    if (atomRef.current) {
      atoms.forEach((a, i) => {
        m.compose(a, q.identity(), s.set(1, 1, 1));
        atomRef.current!.setMatrixAt(i, m);
      });
      atomRef.current.instanceMatrix.needsUpdate = true;
    }
    if (bondRef.current) {
      bonds.forEach(([a, b], i) => {
        const pa = atoms[a];
        const pb = atoms[b];
        const dir = pb.clone().sub(pa);
        const len = dir.length();
        const mid = pa.clone().add(pb).multiplyScalar(0.5);
        q.setFromUnitVectors(up, dir.normalize());
        m.compose(mid, q, s.set(1, len, 1));
        bondRef.current!.setMatrixAt(i, m);
      });
      bondRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [atoms, bonds]);

  return (
    <group {...placement}>
      <instancedMesh ref={atomRef} args={[undefined, undefined, atoms.length]}>
        <sphereGeometry args={[atomRadius, 28, 28]} />
        <Glossy color={color} />
      </instancedMesh>
      <instancedMesh ref={bondRef} args={[undefined, undefined, bonds.length]}>
        <cylinderGeometry args={[bondRadius, bondRadius, 1, 14]} />
        <Glossy color={ORANGE_DEEP} />
      </instancedMesh>
    </group>
  );
}
