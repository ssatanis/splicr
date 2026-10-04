"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

import { MarketingNav } from "@/components/marketing/nav";
import { HeroField } from "@/components/three";
import { LinkButton } from "@/components/ui/bits";

const line = {
  hidden: { opacity: 0, y: 28 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, delay: 0.1 + i * 0.09, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });

  // The artwork drifts and fades as the page moves, so the headline stays the
  // subject rather than competing with it.
  const artY = useTransform(scrollYProgress, [0, 1], ["0%", "18%"]);
  const artOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);
  const copyY = useTransform(scrollYProgress, [0, 1], ["0%", "-12%"]);

  return (
    <section ref={ref} className="relative min-h-[92vh] flex flex-col overflow-hidden">
      <motion.div style={{ y: artY, opacity: artOpacity }} className="absolute inset-0">
        <HeroField className="absolute inset-0" />
      </motion.div>

      <MarketingNav variant="pill" />

      <motion.div
        style={{ y: copyY }}
        className="relative z-10 flex-1 flex flex-col justify-center items-center
                   text-center container-x py-16 md:py-24"
      >
        <motion.h1
          initial="hidden"
          animate="show"
          className="font-serif text-ink leading-[0.95] tracking-[-0.02em]
                     text-[clamp(2.6rem,8vw,6.5rem)] text-balance"
        >
          <motion.span custom={0} variants={line} className="block">
            The answer key
          </motion.span>
          <motion.span custom={1} variants={line} className="block">
            for <span className="text-orange-500">CRISPR</span> screens
          </motion.span>
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.42, ease: [0.22, 1, 0.36, 1] }}
          className="mt-10 md:mt-12 flex flex-wrap items-center justify-center gap-3"
        >
          <LinkButton href="/contact" tone="teal" size="lg" icon="none">
            Request access
          </LinkButton>
          <LinkButton href="/technology" tone="ghost" size="lg" icon="none">
            How it works
          </LinkButton>
        </motion.div>
      </motion.div>

    </section>
  );
}
