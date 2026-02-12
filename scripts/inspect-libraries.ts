
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const librariesDir = path.join(process.cwd(), 'data/libraries/raw');

async function inspect() {
    const files = fs.readdirSync(librariesDir);

    for (const file of files) {
        if (file.startsWith('.')) continue; // skip hidden

        console.log(`\n--- Inspecting ${file} ---`);
        const filePath = path.join(librariesDir, file);

        if (file.endsWith('.csv') || file.endsWith('.txt')) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split(/\r?\n/).filter(x => x.trim());
            console.log(`First line (header): ${lines[0]}`);
            console.log(`Second line: ${lines[1]}`);

            // extensive check for Gecko A
            if (file.includes('gecko-v2-library-a')) {
                console.log('Checking for gene columns in Gecko A...');
                // Check if any line has content in the 4th column (Legacy Name)
                const hasLegacy = lines.slice(1, 100).some(l => {
                    const cols = l.split(','); // simple split, might break on quotes but ok for heuristic
                    return cols[3] && cols[3].replace(/"/g, '').trim().length > 0;
                });
                console.log(`Has data in Legacy Name column (first 100 lines): ${hasLegacy}`);
            }
        } else if (file.endsWith('.xlsx')) {
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            console.log(`Header row:`, data[0]);
            console.log(`First data row:`, data[1]);
        }
    }
}

inspect().catch(console.error);
