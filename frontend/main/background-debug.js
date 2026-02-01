// Debug version to see what electron returns
console.log('Loading electron module...');
const electron = require('electron');
console.log('Electron loaded. Type:', typeof electron);
console.log('Is string?:', typeof electron === 'string');
console.log('Keys:', Object.keys(electron).slice(0, 10));

if (electron.app) {
  console.log('app is available');
  electron.app.on('ready', () => {
    console.log('Electron is ready!');
    electron.app.quit();
  });
} else {
  console.log('app is NOT available');
  console.log('Electron value:', String(electron).substring(0, 200));
}
