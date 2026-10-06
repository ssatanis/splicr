import * as XLSX from "xlsx";
const csv = "sgRNA Sequence,Target Gene Symbol\nACGTACGTACGTACGTACGT,SMAD7\n";
const workbook = XLSX.read(csv, { type: "string", dense: true, raw: true });
console.log(workbook.SheetNames);
const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true });
console.log(rows);
