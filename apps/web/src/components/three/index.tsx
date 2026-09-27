"use client";

import dynamic from "next/dynamic";

const placeholder = () => <div aria-hidden className="w-full h-full" />;

export const HeroField = dynamic(() => import("./scenes").then((m) => m.HeroFieldScene), {
  ssr: false,
  loading: placeholder,
});
export const SideCoil = dynamic(() => import("./scenes").then((m) => m.SideCoilScene), {
  ssr: false,
  loading: placeholder,
});
export const WaveRibbons = dynamic(() => import("./scenes").then((m) => m.WaveRibbonScene), {
  ssr: false,
  loading: placeholder,
});
export const MoleculeArt = dynamic(() => import("./scenes").then((m) => m.MoleculeScene), {
  ssr: false,
  loading: placeholder,
});
export const AccentCoil = dynamic(() => import("./scenes").then((m) => m.AccentCoilScene), {
  ssr: false,
  loading: placeholder,
});
export const DarkHero = dynamic(() => import("./scenes").then((m) => m.DarkHeroScene), {
  ssr: false,
  loading: placeholder,
});
/** AccentCoil, but the reader can turn it. Used on login and signup. */
export const RotatableCoil = dynamic(() => import("./rotatable").then((m) => m.RotatableCoilScene), {
  ssr: false,
  loading: placeholder,
});
