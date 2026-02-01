#!/usr/bin/env node
// Electron launcher script
const { spawn } = require('child_process');
const path = require('path');

// Get the electron binary path
const electronPath = require('electron');

// Set NODE_ENV
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

console.log('Starting Electron...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Electron binary:', electronPath);

// Run Electron with our main file
const electronProcess = spawn(electronPath, [path.join(__dirname, 'main/background.js')], {
  stdio: 'inherit',
  env: {
    ...process.env,
  },
});

electronProcess.on('close', (code) => {
  console.log('Electron exited with code:', code);
  process.exit(code);
});

electronProcess.on('error', (error) => {
  console.error('Failed to start Electron:', error);
  process.exit(1);
});
