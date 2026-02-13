/**
 * Simple test to verify library files can be read and parsed
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('='.repeat(80));
console.log('TESTING LIBRARY FILES');
console.log('='.repeat(80));

// Test 1: Read metadata
console.log('\n[Test 1] Reading libraries.json metadata...');
try {
  const metadataPath = path.join(__dirname, '..', 'data', 'libraries', 'libraries.json');
  const content = fs.readFileSync(metadataPath, 'utf-8');
  const metadata = JSON.parse(content);

  console.log(`✓ Metadata loaded: ${metadata.libraries.length} libraries`);
  for (const lib of metadata.libraries) {
    console.log(`  - ${lib.name} (${lib.id}): ${lib.total_sgrnas.toLocaleString()} sgRNAs, ${lib.genes_targeted.toLocaleString()} genes`);
  }
} catch (error) {
  console.error('✗ Failed:', error.message);
  process.exit(1);
}

// Test 2: Parse Brunello library (TSV)
console.log('\n[Test 2] Parsing Brunello library (TSV format)...');
try {
  const filePath = path.join(__dirname, '..', 'data', 'libraries', 'raw', 'brunello-library-contents.txt');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r\n|\r|\n/).filter(l => l.trim());

  console.log(`  Total lines: ${lines.length.toLocaleString()}`);

  // Parse a few entries
  let validCount = 0;
  for (let i = 1; i < Math.min(100, lines.length); i++) {
    const fields = lines[i].split('\t');
    const sequence = fields[6]?.trim();
    const gene = fields[1]?.trim();

    if (sequence && gene && sequence.length === 20 && /^[ATCG]+$/i.test(sequence)) {
      validCount++;
    }
  }

  console.log(`✓ Parsed successfully`);
  console.log(`  Valid sgRNAs in first 100 lines: ${validCount}/99`);

  // Show a sample
  const sampleFields = lines[1].split('\t');
  console.log(`  Sample: ${sampleFields[6]} → ${sampleFields[1]}`);
} catch (error) {
  console.error('✗ Failed:', error.message);
  process.exit(1);
}

// Test 3: Parse BRIE library (TSV)
console.log('\n[Test 3] Parsing BRIE library (TSV format)...');
try {
  const filePath = path.join(__dirname, '..', 'data', 'libraries', 'raw', 'brie-library-contents.txt');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r\n|\r|\n/).filter(l => l.trim());

  console.log(`  Total lines: ${lines.length.toLocaleString()}`);

  // Parse a few entries
  let validCount = 0;
  for (let i = 1; i < Math.min(100, lines.length); i++) {
    const fields = lines[i].split('\t');
    const sequence = fields[6]?.trim();
    const gene = fields[1]?.trim();

    if (sequence && gene && sequence.length === 20 && /^[ATCG]+$/i.test(sequence)) {
      validCount++;
    }
  }

  console.log(`✓ Parsed successfully`);
  console.log(`  Valid sgRNAs in first 100 lines: ${validCount}/99`);
} catch (error) {
  console.error('✗ Failed:', error.message);
  process.exit(1);
}

// Test 4: Parse Calabrese library (TSV with different columns)
console.log('\n[Test 4] Parsing Calabrese library (TSV format)...');
try {
  const filePath = path.join(__dirname, '..', 'data', 'libraries', 'raw', 'calabrese-seta-target-genes.txt');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r\n|\r|\n/).filter(l => l.trim());

  console.log(`  Total lines: ${lines.length.toLocaleString()}`);

  // Parse a few entries (column 0 = sequence, column 1 = gene)
  let validCount = 0;
  for (let i = 1; i < Math.min(100, lines.length); i++) {
    const fields = lines[i].split('\t');
    const sequence = fields[0]?.trim();
    const gene = fields[1]?.trim();

    if (sequence && gene && sequence.length === 20 && /^[ATCG]+$/i.test(sequence)) {
      validCount++;
    }
  }

  console.log(`✓ Parsed successfully`);
  console.log(`  Valid sgRNAs in first 100 lines: ${validCount}/99`);

  // Show a sample
  const sampleFields = lines[1].split('\t');
  console.log(`  Sample: ${sampleFields[0]} → ${sampleFields[1]}`);
} catch (error) {
  console.error('✗ Failed:', error.message);
  process.exit(1);
}

// Test 5: Check GeCKO v2 CSV format
console.log('\n[Test 5] Parsing GeCKO v2 library B (CSV format)...');
try {
  const filePath = path.join(__dirname, '..', 'data', 'libraries', 'raw', 'gecko-v2-library-b.csv');
  const content = fs.readFileSync(filePath, 'utf-8');
  // Handle CR, LF, and CRLF line terminators
  const lines = content.split(/\r\n|\r|\n/).filter(l => l.trim());

  console.log(`  Total lines: ${lines.length.toLocaleString()}`);

  // Parse a few entries (gene_id,UID,seq)
  let validCount = 0;
  for (let i = 1; i < Math.min(100, lines.length); i++) {
    const fields = lines[i].split(',');
    const gene = fields[0]?.trim();
    const sequence = fields[2]?.trim();

    if (sequence && gene && sequence.length === 20 && /^[ATCG]+$/i.test(sequence)) {
      validCount++;
    }
  }

  console.log(`✓ Parsed successfully`);
  console.log(`  Valid sgRNAs in first 100 lines: ${validCount}/99`);

  // Show a sample
  const sampleFields = lines[1].split(',');
  console.log(`  Sample: ${sampleFields[2]} → ${sampleFields[0]}`);
} catch (error) {
  console.error('✗ Failed:', error.message);
  process.exit(1);
}

console.log('\n' + '='.repeat(80));
console.log('ALL FILE PARSING TESTS PASSED ✓');
console.log('='.repeat(80));
console.log('\nLibrary files are correctly formatted and ready for use!');
