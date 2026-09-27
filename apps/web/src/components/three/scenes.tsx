"use client";

import { useThree } from "@react-three/fiber";

import {
  CoilRibbon,
  CYAN,
  Drift,
  Molecule,
  ORANGE,
  Scene,
  SmoothTube,
  Studio,
  TwistRibbon,
} from "./primitives";

/**
 * Corner positions as fractions of the visible viewport rather than fixed
 * world units, so the four ribbons still frame the edges of the screen on a
 * narrow/tall phone viewport instead of drifting off the sides of the camera
 * frustum the way fixed x positions do.
 */
function useCorners() {
  const { width, height } = useThree((s) => s.viewport);
  const halfW = width / 2;
  const halfH = height / 2;
  // On a narrow phone viewport halfW shrinks a lot more than halfH does, so
  // the ribbons (whose own size is fixed in world units) are scaled down too
  // — otherwise they'd swallow the whole width instead of framing a corner.
  const REFERENCE_HALF_W = 8;
  const objectScale = Math.min(1, Math.max(0.4, halfW / REFERENCE_HALF_W));
  return {
    topLeft: [-0.92 * halfW, 0.72 * halfH, -1] as const,
    topRight: [0.9 * halfW, 0.7 * halfH, -1.5] as const,
    bottomLeft: [-0.88 * halfW, -0.76 * halfH, -0.5] as const,
    bottomRight: [0.89 * halfW, -0.72 * halfH, -1] as const,
    objectScale,
  };
}

/** Ribbons and tubes framing the four corners of the home hero. */
function HeroFieldRig() {
  const { topLeft, topRight, bottomLeft, bottomRight, objectScale } = useCorners();
  return (
    <>
      <Studio />
      {/* top left */}
      <Drift speed={0.8} rotation={0.25} float={0.5}>
        <group position={topLeft} rotation={[0.2, 0.4, 0.3]} scale={objectScale}>
          <SmoothTube seed={11} spread={[2.2, 1.6, 1]} radius={0.13} />
          <CoilRibbon seed={21} spread={[2.4, 1, 0.8]} radius={0.45} turns={6} scale={0.8} position={[0.2, -1.4, 0.4]} rotation={[0.3, 0.2, 0.9]} />
        </group>
      </Drift>
      {/* top right */}
      <Drift speed={0.9} rotation={0.3} float={0.6}>
        <group position={topRight} rotation={[-0.2, -0.5, 0.2]} scale={objectScale}>
          <CoilRibbon seed={5} spread={[2.6, 1.2, 0.9]} radius={0.5} turns={7} scale={0.85} />
          <SmoothTube seed={19} spread={[2, 1.6, 1]} radius={0.12} position={[0.4, -1.2, 0.6]} rotation={[0.4, 0.5, 0.1]} />
        </group>
      </Drift>
      {/* bottom left */}
      <Drift speed={0.7} rotation={0.2} float={0.5}>
        <group position={bottomLeft} rotation={[0.3, -0.3, -0.4]} scale={objectScale}>
          <CoilRibbon seed={33} spread={[3.2, 1.2, 0.9]} radius={0.62} turns={8} width={0.5} />
        </group>
      </Drift>
      {/* bottom right */}
      <Drift speed={0.85} rotation={0.3} float={0.6}>
        <group position={bottomRight} rotation={[0.4, 0.4, 0.6]} scale={objectScale}>
          <SmoothTube seed={41} spread={[2.5, 2, 1.1]} radius={0.14} />
          <CoilRibbon seed={47} spread={[2.2, 1, 0.8]} radius={0.42} turns={6} scale={0.75} position={[0.6, 1.2, 0.3]} rotation={[0.8, 0.3, 0.2]} />
        </group>
      </Drift>
    </>
  );
}

/** Ribbons and tubes framing the four corners of the home hero. */
export function HeroFieldScene({ className }: { className?: string }) {
  return (
    <Scene className={className} camera={{ position: [0, 0, 14], fov: 34 }}>
      <HeroFieldRig />
    </Scene>
  );
}

/** A large coil with a cyan loop, for split layouts. */
export function SideCoilScene({ className, mirror = false }: { className?: string; mirror?: boolean }) {
  const s = mirror ? -1 : 1;
  return (
    <Scene className={className} camera={{ position: [0, 0, 11], fov: 34 }}>
      <Studio />
      <Drift speed={0.8} rotation={0.35} float={0.7}>
        <group rotation={[0.35 * s, 0.5 * s, 0.15]}>
          <SmoothTube seed={61} spread={[2.6, 2.6, 1.6]} radius={0.16} position={[-1.2 * s, 1.4, -0.8]} />
          <CoilRibbon seed={71} spread={[3.4, 1.6, 1.2]} radius={0.7} turns={9} width={0.55} thickness={0.08} position={[0.6 * s, -0.6, 0]} />
          <CoilRibbon seed={73} spread={[2, 1, 0.8]} radius={0.42} turns={6} scale={0.7} position={[-2.4 * s, -2.2, 0.8]} rotation={[0.6, 0.2, 1.2]} />
        </group>
      </Drift>
    </Scene>
  );
}

/**
 * Two side positions as fractions of the visible viewport, same trick as
 * useCorners: this is one full-width canvas, so there is no div edge to
 * clip the coils — they just taper off naturally at the frustum's edge.
 */
function useSides() {
  const { width } = useThree((s) => s.viewport);
  const halfW = width / 2;
  return {
    left: -0.86 * halfW,
    right: 0.86 * halfW,
  };
}

/** A coil framing each edge of a hero, mirrored, sharing one canvas so
    neither is clipped by a container boundary. */
function SideFrameRig() {
  const { left, right } = useSides();
  return (
    <>
      <Studio />
      <Drift speed={0.8} rotation={0.35} float={0.7}>
        <group position={[left, 0, -0.5]} rotation={[-0.35, -0.5, 0.15]}>
          <SmoothTube seed={61} spread={[2.6, 2.6, 1.6]} radius={0.16} position={[1.2, 1.4, -0.8]} />
          <CoilRibbon seed={71} spread={[3.4, 1.6, 1.2]} radius={0.7} turns={9} width={0.55} thickness={0.08} position={[-0.6, -0.6, 0]} />
          <CoilRibbon seed={73} spread={[2, 1, 0.8]} radius={0.42} turns={6} scale={0.7} position={[2.4, -2.2, 0.8]} rotation={[0.6, 0.2, 1.2]} />
        </group>
      </Drift>
      <Drift speed={0.75} rotation={0.3} float={0.65}>
        <group position={[right, 0, -1]} rotation={[0.35, 0.5, 0.15]}>
          <SmoothTube seed={81} spread={[2.6, 2.6, 1.6]} radius={0.16} position={[-1.2, 1.4, -0.8]} />
          <CoilRibbon seed={83} spread={[3.4, 1.6, 1.2]} radius={0.7} turns={9} width={0.55} thickness={0.08} position={[0.6, -0.6, 0]} />
          <CoilRibbon seed={85} spread={[2, 1, 0.8]} radius={0.42} turns={6} scale={0.7} position={[-2.4, -2.2, 0.8]} rotation={[0.6, 0.2, 1.2]} />
        </group>
      </Drift>
    </>
  );
}

/** Coils framing the far left and right edges of a hero, one canvas wide. */
export function SideFrameScene({ className }: { className?: string }) {
  return (
    <Scene className={className} camera={{ position: [0, 0, 11], fov: 34 }}>
      <SideFrameRig />
    </Scene>
  );
}

/** Three wide twisted ribbons across the pipeline section. */
export function WaveRibbonScene({ className }: { className?: string }) {
  return (
    <Scene className={className} camera={{ position: [0, 0, 12], fov: 30 }}>
      <Studio />
      <Drift speed={0.5} rotation={0.05} float={0.3}>
        <group rotation={[0.25, 0, 0]}>
          <TwistRibbon length={19} amplitude={1.1} waves={2.4} phase={0} z={0} width={1.05} twist={Math.PI * 2.5} position={[0, 0.9, 0]} />
          <TwistRibbon length={19} amplitude={1.0} waves={2.2} phase={1.7} z={-0.6} width={0.95} twist={Math.PI * 3} position={[0, -0.3, 0]} />
          <TwistRibbon length={19} amplitude={0.9} waves={2.6} phase={3.4} z={0.5} width={0.8} twist={Math.PI * 2} position={[0, -1.4, 0]} color={ORANGE} />
        </group>
      </Drift>
    </Scene>
  );
}

/** The ball-and-stick molecule for the dark "redefined" section. */
export function MoleculeScene({ className, spin = 0 }: { className?: string; spin?: number }) {
  return (
    <Scene className={className} camera={{ position: [0, 0, 13], fov: 32 }}>
      <Studio intensity={1.05} />
      <Drift speed={0.7} rotation={0.5} float={0.4}>
        <group rotation={[0, spin * Math.PI, 0]}>
          <Molecule seed={9} rings={7} rotation={[0.5, -0.3, 0.2]} scale={0.72} position={[0.3, 0.2, 0]} />
        </group>
      </Drift>
    </Scene>
  );
}

/** Compact coil for login and cards. */
export function AccentCoilScene({ className, color = ORANGE }: { className?: string; color?: string }) {
  return (
    <Scene className={className} camera={{ position: [0, 0, 9], fov: 34 }}>
      <Studio />
      <Drift speed={0.8} rotation={0.4} float={0.6}>
        <group rotation={[0.3, 0.4, 0.2]}>
          <CoilRibbon seed={81} spread={[2.6, 1.4, 1]} radius={0.62} turns={8} width={0.5} thickness={0.08} color={color} />
          <SmoothTube seed={83} spread={[2.2, 2, 1.2]} radius={0.14} position={[0.4, 0.6, -0.6]} color={CYAN} />
        </group>
      </Drift>
    </Scene>
  );
}

/** Wide, two-tone scene for dark heroes (about page). */
export function DarkHeroScene({ className }: { className?: string }) {
  return (
    <Scene className={className} camera={{ position: [0, 0, 12], fov: 34 }}>
      <Studio intensity={1.1} />
      <Drift speed={0.7} rotation={0.3} float={0.5}>
        <group position={[2.2, 0, 0]} rotation={[0.3, -0.4, 0.1]}>
          <SmoothTube seed={91} spread={[4, 2.6, 1.6]} radius={0.17} position={[-2.5, 0.4, -0.5]} />
          <CoilRibbon seed={93} spread={[3.6, 1.6, 1.4]} radius={0.72} turns={10} width={0.55} thickness={0.08} position={[1.4, 0.2, 0]} />
          <CoilRibbon seed={95} spread={[2.4, 1.2, 0.9]} radius={0.5} turns={7} scale={0.8} position={[0.2, -2.4, 0.6]} rotation={[0.8, 0.2, 0.9]} />
          <SmoothTube seed={97} spread={[2.4, 1.6, 1.2]} radius={0.13} position={[3.2, -1.8, 0.4]} rotation={[0.3, 0.7, 0.2]} />
        </group>
      </Drift>
    </Scene>
  );
}
