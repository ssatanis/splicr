import { cn } from "@/lib/utils";

export function Orb({
  size = 160,
  tone = "orange",
  className,
}: {
  size?: number;
  tone?: "orange" | "cyan";
  className?: string;
}) {
  return (
    <div
      className={cn("orb shrink-0", tone === "cyan" && "orb-cyan", className)}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
