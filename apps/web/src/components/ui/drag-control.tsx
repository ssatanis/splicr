"use client";

import { GripHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A draggable handle. Drag it left or right (or use the arrow keys) and it
 * reports a value from -1 to 1, which the caller maps onto something visible,
 * here the rotation of the molecule behind it.
 */
export function DragControl({
  onChange,
  className,
  label = "Drag to rotate",
}: {
  onChange: (value: number) => void;
  className?: string;
  label?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(0);
  const [dragging, setDragging] = useState(false);

  const commit = useCallback(
    (v: number) => {
      const clamped = Math.max(-1, Math.min(1, v));
      setValue(clamped);
      onChange(clamped);
    },
    [onChange],
  );

  const fromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * 2 - 1;
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      e.preventDefault();
      commit(fromClientX(e.clientX));
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [dragging, commit, fromClientX]);

  return (
    <div
      ref={trackRef}
      className={cn("relative h-12 w-full max-w-sm touch-none select-none", className)}
      onPointerDown={(e) => {
        setDragging(true);
        commit(fromClientX(e.clientX));
      }}
    >
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-white/20" aria-hidden />
      <button
        type="button"
        role="slider"
        aria-label={label}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") commit(value - 0.08);
          if (e.key === "ArrowRight") commit(value + 0.08);
          if (e.key === "Home") commit(0);
        }}
        className={cn(
          "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 inline-flex items-center gap-2 rounded-full bg-cyan-500 px-7 py-3 text-white shadow-float transition-[transform,background-color] outline-none",
          "hover:bg-cyan-400 focus-visible:ring-2 focus-visible:ring-white/70",
          dragging ? "cursor-grabbing scale-[1.04]" : "cursor-grab",
        )}
        style={{ left: `${((value + 1) / 2) * 100}%` }}
      >
        <GripHorizontal className="w-4 h-4" />
        <span className="text-xs font-medium tracking-wide">Drag</span>
      </button>
    </div>
  );
}
