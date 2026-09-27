"use client";

/**
 * The FAQ accordion.
 *
 * A disclosure pattern, not a tab set: several answers can be open at once,
 * because someone comparing two answers should not have to close one to read
 * the other.
 *
 * Built on a button and a region rather than on <details>, for one reason: a
 * native <details> cannot animate its own height, and forcing it to leaves the
 * content in the accessibility tree while it is visually collapsed. Here the
 * panel is unmounted when closed, so a screen reader and a sighted reader see
 * the same thing, and `hidden` never disagrees with `aria-expanded`.
 *
 * The answer is still in the server-rendered HTML for the open items only, so
 * nothing here depends on JavaScript to be findable: the questions are real
 * text in the document either way.
 */

import { Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";

import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/use-reduced-motion";

export interface FaqItem {
  q: string;
  a: string;
}

function Row({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const reduced = useReducedMotion();

  return (
    <div className="border-b border-line">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          id={`${id}-button`}
          className="w-full flex items-start justify-between gap-6 py-6 text-left group"
        >
          <span className="text-ink text-lg md:text-xl font-medium leading-snug">
            {item.q}
          </span>
          <span
            aria-hidden
            className={cn(
              "shrink-0 mt-1 w-7 h-7 rounded-full border border-line-strong",
              "flex items-center justify-center transition-all duration-300",
              "group-hover:border-ink",
              open && "rotate-45 bg-ink border-ink",
            )}
          >
            <Plus
              className={cn("w-3.5 h-3.5 transition-colors", open ? "text-white" : "text-ink")}
              strokeWidth={2}
            />
          </span>
        </button>
      </h3>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            id={`${id}-panel`}
            role="region"
            aria-labelledby={`${id}-button`}
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="pb-6 pr-12 text-body leading-relaxed max-w-2xl">{item.a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Faq({ items }: { items: readonly FaqItem[] }) {
  return (
    <div className="border-t border-line">
      {items.map((item) => (
        <Row key={item.q} item={item} />
      ))}
    </div>
  );
}
