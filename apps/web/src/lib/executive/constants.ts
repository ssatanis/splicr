export const EXECUTIVES = {
  "ss4497@cornell.edu": { name: "Sahaj Satani", shortName: "Sahaj" },
  "is455@cornell.edu": { name: "Ishaan Samantray", shortName: "Ishaan" },
  "prm93@cornell.edu": { name: "Pranav Mettu", shortName: "Pranav" },
} as const;

export type ExecutiveEmail = keyof typeof EXECUTIVES;
