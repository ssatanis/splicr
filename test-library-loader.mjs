/**
 * Test script for library loader
 *
 * Run with: node test-library-loader.mjs
 */

import { getLibraryMetadata, loadLibrary, matchSequences, aggregateByGene, calculateQCMetrics } from './frontend/src/lib/libraryLoader.ts';

console.log('='.repeat(80));
console.log('TESTING LIBRARY LOADER');
console.log('='.repeat(80));

// Test 1: Load metadata
console.log('\n[Test 1] Loading library metadata...');
try {
  const libraries = getLibraryMetadata();
  console.log(`✓ Loaded ${libraries.length} libraries:`);
  for (const lib of libraries) {
    console.log(`  - ${lib.name} (${lib.id}): ${lib.total_sgrnas.toLocaleString()} sgRNAs`);
  }
} catch (error) {
  console.error('✗ Failed to load metadata:', error.message);
  process.exit(1);
}

// Test 2: Load a specific library (Brunello - smallest one for testing)
console.log('\n[Test 2] Loading Brunello library...');
try {
  const startTime = Date.now();
  const library = await loadLibrary('brunello');
  const loadTime = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`✓ Loaded ${library.metadata.name} in ${loadTime}s`);
  console.log(`  Total sgRNAs loaded: ${library.totalLoaded.toLocaleString()}`);
  console.log(`  Map size: ${library.sgRNAMap.size.toLocaleString()}`);

  // Show a few sample entries
  const samples = Array.from(library.sgRNAMap.entries()).slice(0, 5);
  console.log(`  Sample entries:`);
  for (const [seq, info] of samples) {
    console.log(`    ${seq} → ${info.gene_symbol} (${info.gene_id || 'N/A'})`);
  }
} catch (error) {
  console.error('✗ Failed to load library:', error.message);
  console.error(error.stack);
  process.exit(1);
}

// Test 3: Test sequence matching
console.log('\n[Test 3] Testing sequence matching...');
try {
  const library = await loadLibrary('brunello');

  // Create some test sequences (get actual sequences from the library)
  const testSequences = new Map();
  const sampleEntries = Array.from(library.sgRNAMap.entries()).slice(0, 10);

  for (const [seq] of sampleEntries) {
    testSequences.set(seq, Math.floor(Math.random() * 1000) + 100);
  }

  // Add some fake sequences that won't match
  testSequences.set('AAAAAAAAAAAAAAAAAAAA', 50);
  testSequences.set('TTTTTTTTTTTTTTTTTTTT', 30);

  console.log(`  Testing with ${testSequences.size} sequences...`);

  const { matches, unmatched, stats } = matchSequences(testSequences, library);

  console.log(`✓ Matching complete:`);
  console.log(`  Matches: ${matches.length}`);
  console.log(`  Unmatched: ${unmatched.length}`);
  console.log(`  Match rate: ${(stats.matchRate * 100).toFixed(1)}%`);
  console.log(`  Total reads: ${stats.totalReads.toLocaleString()}`);
} catch (error) {
  console.error('✗ Failed to match sequences:', error.message);
  process.exit(1);
}

// Test 4: Test gene aggregation
console.log('\n[Test 4] Testing gene aggregation...');
try {
  const library = await loadLibrary('brunello');

  const testSequences = new Map();
  const sampleEntries = Array.from(library.sgRNAMap.entries()).slice(0, 20);

  for (const [seq] of sampleEntries) {
    testSequences.set(seq, Math.floor(Math.random() * 1000) + 100);
  }

  const { matches, stats } = matchSequences(testSequences, library);
  const geneAgg = aggregateByGene(matches, stats.totalReads);

  console.log(`✓ Aggregation complete:`);
  console.log(`  Genes detected: ${geneAgg.length}`);
  console.log(`  Top 3 genes by read count:`);
  for (const gene of geneAgg.slice(0, 3)) {
    console.log(`    ${gene.gene}: ${gene.totalReads.toLocaleString()} reads (${gene.sgRNACount} sgRNAs, ${gene.rpm.toFixed(1)} RPM)`);
  }
} catch (error) {
  console.error('✗ Failed to aggregate:', error.message);
  process.exit(1);
}

// Test 5: Test QC metrics
console.log('\n[Test 5] Testing QC metrics...');
try {
  const library = await loadLibrary('brunello');

  const testSequences = new Map();
  const sampleEntries = Array.from(library.sgRNAMap.entries()).slice(0, 1000);

  for (const [seq] of sampleEntries) {
    testSequences.set(seq, Math.floor(Math.random() * 1000) + 100);
  }

  const { matches, stats } = matchSequences(testSequences, library);
  const qc = calculateQCMetrics(matches, stats, library);

  console.log(`✓ QC metrics calculated:`);
  console.log(`  Overall quality: ${qc.overallQuality}`);
  console.log(`  Match rate quality: ${qc.matchRateQuality} (${(qc.matchRate).toFixed(1)}%)`);
  console.log(`  Library coverage quality: ${qc.libraryQuality} (${(qc.libraryCoverage).toFixed(1)}%)`);
  console.log(`  Gini coefficient: ${qc.giniCoefficient.toFixed(3)} (${qc.giniQuality})`);
  console.log(`  Recommendation: ${qc.recommendation}`);
} catch (error) {
  console.error('✗ Failed to calculate QC:', error.message);
  process.exit(1);
}

console.log('\n' + '='.repeat(80));
console.log('ALL TESTS PASSED ✓');
console.log('='.repeat(80));
