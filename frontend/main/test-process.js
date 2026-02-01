// Check if we're running in Electron
console.log('=== Process Information ===');
console.log('process.versions.electron:', process.versions.electron);
console.log('process.versions.node:', process.versions.node);
console.log('process.type:', process.type);
console.log('process.versions.chrome:', process.versions.chrome);

console.log('\n=== Module Resolution ===');
console.log('__dirname:', __dirname);
console.log('__filename:', __filename);

console.log('\n=== Attempting to load electron ===');
try {
  const electronExport = require('electron');
  console.log('require(\'electron\') returned type:', typeof electronExport);
  console.log('Value (first 100 chars):', String(electronExport).substring(0, 100));

  // Try destructuring
  try {
    const { app } = require('electron');
    console.log('Destructured app:', typeof app);
  } catch (e) {
    console.log('Destructuring failed:', e.message);
  }
} catch (error) {
  console.log('Failed to require electron:', error.message);
}

// Try accessing from global or process
console.log('\n=== Checking global scope ===');
console.log('global.electron:', typeof global.electron);
console.log('process.electron:', typeof process.electron);

setTimeout(() => {
  console.log('\nExiting...');
  process.exit(0);
}, 1000);
