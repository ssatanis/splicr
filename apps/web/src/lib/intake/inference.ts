/** Conservative defaults. Uploaded metadata and explicit edits take precedence. */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateFromFiles(names: string[]): string | null {
  const dates = names
    .flatMap((name) =>
      [...name.matchAll(/(?:^|\D)(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)(?=\D|$)/g)].map(
        (match) => `${match[1]}-${match[2]}-${match[3]}`,
      ),
    )
    .filter((date) => {
      const value = new Date(`${date}T12:00:00Z`);
      return (
        Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date
      );
    });
  return new Set(dates).size === 1 ? dates[0] : null;
}
export function nameFromFiles(names: string[]): string {
  const name = names.find((name) => /counts?|fastq|\.fq/i.test(name)) ?? names[0] ?? "";
  return (
    name
      .split("/")
      .pop()!
      .replace(/\.(fastq|fq|tsv|txt|csv|xlsx?|ods|json)(\.gz)?$/i, "")
      .replace(/^(counts?|screen)[_-]+/i, "")
      .replace(/(?:[_-]allinone|[_-]R[12](?:_001)?|_S\d+_L\d{3})$/gi, "")
      .replace(/[_-]+/g, " ")
      .trim()
      .slice(0, 120) || "Untitled screen"
  );
}
export function sampleFactors(label: string): Record<string, string> {
  const withoutRep = label
    .replace(/(?:^|[_ .-])(?:rep(?:licate)?|r)[_ .-]?(?:\d+|[a-z])$/i, "")
    .replace(/[_ .-](?:\d{1,2}|[a-z])$/i, "");
  const time = withoutRep.match(/(?:^|[_ .-])(?:D|day|T)[_ ]?(\d+)(?:[_ .-]|$)/i);
  const condition = withoutRep.replace(/^(?:D|day|T)[_ ]?\d+[_ .-]*/i, "");
  const leading = condition.match(/^([A-Za-z]{1,8}\d{2,5})(?:[_ .-]|$)/)?.[1];
  return {
    condition: condition || "Endpoint",
    ...(time ? { timepoint: time[1] } : {}),
    ...(leading && !/^(CP|SRR|ERR|DRR)\d+/i.test(leading) ? { model: leading } : {}),
  };
}
export function confidentLibrary(
  candidates: { library_id: string; match_rate: number; n_matched?: number }[],
): string | null {
  const sorted = [...candidates].sort((a, b) => b.match_rate - a.match_rate);
  const first = sorted[0];
  return first &&
    first.match_rate >= 0.95 &&
    (first.n_matched ?? 50) >= 50 &&
    (!sorted[1] || first.match_rate - sorted[1].match_rate >= 0.05)
    ? first.library_id
    : null;
}
