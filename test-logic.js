const samples = [
  { label: "A375 repA", role: "treatment" },
  { label: "A375 repB", role: "treatment" },
  { label: "A549 repA", role: "treatment" },
  { label: "A549 repB", role: "treatment" },
  { label: "CP0082_pDNA", role: "reference" }
];
const controls = samples.filter(s => s.role === "control").map(s => s.label);
const references = samples.filter(s => s.role === "reference").map(s => s.label);

const groups = new Map();
samples.filter((sample) => sample.role === "treatment" && !/^empty$/i.test(sample.label)).forEach((sample) => {
  let condition = sample.factors?.condition || sample.label.replace(/(?:^|[_ .-])(?:(?:rep(?:licate)?|r)[_ .-]?([0-9]{1,2}|[A-Za-z])|[_ .-]+([0-9]{1,2}|[A-Za-z]))$/i, "").replace(/^(?:D|day)[_ ]?\d+[_ .-]+/i, "");
  const timepoint = sample.factors?.timepoint ?? "", dose = sample.factors?.dose ?? "";
  const key = [condition, timepoint, dose].filter(Boolean).join(" / ");
  groups.set(key, { condition, timepoint, treatment: [...(groups.get(key)?.treatment ?? []), sample.label] });
});
console.log(groups);
