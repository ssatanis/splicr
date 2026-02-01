// Try different ways to access Electron APIs
console.log('Testing different import methods...\n');

// Method 1: Standard require
console.log('Method 1: require(\'electron\')');
try {
  const electron1 = require('electron');
  console.log('  Type:', typeof electron1);
  console.log('  Has app?:', !!electron1.app);
} catch (e) {
  console.log('  Error:', e.message);
}

// Method 2: Try requiring internal electron
console.log('\nMethod 2: process.electronBinding');
try {
  if (typeof process.electronBinding === 'function') {
    console.log('  electronBinding exists!');
    const electron2 = process.electronBinding('electron');
    console.log('  Type:', typeof electron2);
  } else {
    console.log('  electronBinding not available');
  }
} catch (e) {
  console.log('  Error:', e.message);
}

// Method 3: Try process._linkedBinding
console.log('\nMethod 3: process._linkedBinding');
try {
  if (typeof process._linkedBinding === 'function') {
    console.log('  _linkedBinding exists!');
  } else {
    console.log('  _linkedBinding not available');
  }
} catch (e) {
  console.log('  Error:', e.message);
}

// Method 4: Check what's available in process
console.log('\nMethod 4: Process methods');
const processMethods = Object.keys(process).filter(k => k.includes('elect') || k.includes('bind'));
console.log('  Electron-related methods:', processMethods);

// Method 5: Try using createRequire
console.log('\nMethod 5: Using module.createRequire');
try {
  const { createRequire } = require('module');
  const electronPath = require.resolve('electron');
  console.log('  Resolved path:', electronPath);

  // Try requiring from Electron's app folder
  const electronAppPath = electronPath.replace('/index.js', '');
  console.log('  App path:', electronAppPath);
} catch (e) {
  console.log('  Error:', e.message);
}

setTimeout(() => process.exit(0), 1000);
