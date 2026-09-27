"use client";

import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import type * as THREE from "three";

import { cn } from "@/lib/utils";

import { CoilRibbon, CYAN, Drift, ORANGE, Scene, SmoothTube, Studio, useReducedMotion } from "./primitives";

type Spin = { x: number; y: number };

const KEY_STEP = Math.PI / 12; // 15 degrees, so a held arrow key gets somewhere
const PITCH_LIMIT = 0.85; // past this the coil turns edge-on and reads as a smudge

function clamp(v: number, limit: number) {
  return Math.max(-limit, Math.min(limit, v));
}

/**
 * Carries the pointer and keyboard target into the scene graph.
 *
 * The target lives in a ref rather than in state because a drag emits a move
 * event per frame, and re-rendering the whole canvas that often would drop
 * frames on the machines this runs on. Easing toward the target is also what
 * makes a flick feel like it has weight; under prefers-reduced-motion we assign
 * the rotation outright, so the model tracks the cursor exactly and nothing
 * keeps moving after the hand stops.
 */
function Spun({
  target,
  immediate,
  children,
}: {
  target: React.RefObject<Spin>;
  immediate: boolean;
  children: React.ReactNode;
}) {
  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = target.current;
    if (immediate) {
      g.rotation.set(t.x, t.y, 0);
      return;
    }
    g.rotation.x += (t.x - g.rotation.x) * 0.14;
    g.rotation.y += (t.y - g.rotation.y) * 0.14;
  });

  return <group ref={group}>{children}</group>;
}

/**
 * The login and signup artwork, turnable by hand.
 *
 * Deliberately unmarked. There is no handle, caption or icon, because a hint
 * that the decoration is a toy would make the decoration the subject. The only
 * signal is the grab cursor under the pointer, which costs nothing to anyone
 * who never tries it.
 *
 * That leaves keyboard and screen-reader users, who cannot see a cursor. They
 * get the same thing the pointer gets, through an ARIA slider on the wrapper:
 * it is in the tab order, the arrow keys turn it, Home returns it to where it
 * started, and the global :focus-visible ring shows where focus is. The value
 * it reports is the yaw in degrees, which is the axis both inputs share. A drag
 * can also tilt, which is a bonus of the gesture rather than a function the
 * keyboard is missing.
 *
 * On touch the wrapper keeps pan-y, so a finger sliding down the page still
 * scrolls it and only a sideways drag turns the model. Losing tilt on a phone
 * is a better trade than trapping the scroll inside the artwork.
 */
export function RotatableCoilScene({
  className,
  label = "Rotate the artwork",
}: {
  className?: string;
  label?: string;
}) {
  const reduced = useReducedMotion();
  const target = useRef<Spin>({ x: 0, y: 0 });
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  // Mirrors the target for aria-valuenow only, so it updates once a gesture
  // ends rather than on every pointer move.
  const [yaw, setYaw] = useState(0);

  const degrees = Math.round(((((yaw * 180) / Math.PI) % 360) + 540) % 360) - 180;

  return (
    <div
      className={cn(
        "cursor-grab touch-pan-y select-none active:cursor-grabbing",
        className,
      )}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={-180}
      aria-valuemax={180}
      aria-valuenow={degrees}
      aria-valuetext={`${degrees} degrees`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        dragging.current = true;
        last.current = { x: e.clientX, y: e.clientY };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        // A capture can be taken away mid-gesture, and then the next move
        // arrives with no button held. Without this the model would follow a
        // hovering cursor, which is the one thing it must never do.
        if (e.buttons === 0) {
          dragging.current = false;
          setYaw(target.current.y);
          return;
        }
        const dx = e.clientX - last.current.x;
        const dy = e.clientY - last.current.y;
        last.current = { x: e.clientX, y: e.clientY };
        target.current.y += dx * 0.007;
        target.current.x = clamp(target.current.x + dy * 0.005, PITCH_LIMIT);
      }}
      onPointerUp={() => {
        dragging.current = false;
        setYaw(target.current.y);
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setYaw(target.current.y);
      }}
      onLostPointerCapture={() => {
        dragging.current = false;
        setYaw(target.current.y);
      }}
      onKeyDown={(e) => {
        let next = target.current.y;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") next += KEY_STEP;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next -= KEY_STEP;
        else if (e.key === "Home") next = 0;
        else return;
        e.preventDefault();
        target.current.y = next;
        if (e.key === "Home") target.current.x = 0;
        setYaw(next);
      }}
    >
      {/* Scene marks its own wrapper pointer-events-none and aria-hidden, so
          the gesture and the accessible name both belong to the div above. */}
      <Scene className="absolute inset-0" camera={{ position: [0, 0, 9], fov: 34 }}>
        <Studio />
        <Spun target={target} immediate={reduced}>
          <Drift speed={0.8} rotation={0.4} float={0.6}>
            <group rotation={[0.3, 0.4, 0.2]}>
              <CoilRibbon
                seed={81}
                spread={[2.6, 1.4, 1]}
                radius={0.62}
                turns={8}
                width={0.5}
                thickness={0.08}
                color={ORANGE}
              />
              <SmoothTube
                seed={83}
                spread={[2.2, 2, 1.2]}
                radius={0.14}
                position={[0.4, 0.6, -0.6]}
                color={CYAN}
              />
            </group>
          </Drift>
        </Spun>
      </Scene>
    </div>
  );
}
