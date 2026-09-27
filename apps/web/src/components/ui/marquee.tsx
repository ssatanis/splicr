import { LogoMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

export function Marquee({
  items,
  reverse = false,
  className,
}: {
  items: string[];
  reverse?: boolean;
  className?: string;
}) {
  const track = (
    <div className="marquee-track items-center" aria-hidden={reverse}>
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className="inline-flex items-center gap-6 whitespace-nowrap">
          <LogoMark tone="orange" className="h-4 w-4 shrink-0" />
          <span className="text-2xl md:text-4xl font-light text-white tracking-tight">{item}</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={cn("marquee py-2", reverse && "marquee-reverse", className)}>
      {track}
      {track}
    </div>
  );
}
