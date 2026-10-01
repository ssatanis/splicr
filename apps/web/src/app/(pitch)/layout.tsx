import { PitchShell } from "@/components/pitch/pitch-shell";

export const metadata = {
  title: "Advanced Workspace",
  description: "An illustrative SplicR target-diligence workspace.",
};

export default function PitchLayout({ children }: { children: React.ReactNode }) {
  return <PitchShell>{children}</PitchShell>;
}
