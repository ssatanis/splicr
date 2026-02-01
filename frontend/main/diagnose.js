// Let's see what's actually available
console.log('=== Available in global scope ===');
console.log('Keys in global that contain "electron":', Object.keys(global).filter(k => k.toLowerCase().includes('elect')));

console.log('\n=== Process binding attempt ===');
try {
  const binding = process.binding;
  console.log('process.binding exists:', typeof binding);
  if (binding) {
    // Try common binding names
    const names = ['electron_common_api', 'atom_common_api', 'electron'];
    names.forEach(name => {
      try {
        const bound = binding(name);
        console.log(`binding('${name}'):`, typeof bound);
      } catch (e) {
        console.log(`binding('${name}'): error -`, e.message.split('\n')[0]);
      }
    });
  }
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n=== What does require.resolve return? ===');
try {
  const resolved = require.resolve('electron');
  console.log('Resolved path:', resolved);
  
  // Try to actually read what's exported
  const electronModule = require('electron');
  console.log('Module type:', typeof electronModule);
  console.log('Is it just a string?:', typeof electronModule === 'string');
  
  // Try to access the module's module object
  const electronModuleObject = require.cache[resolved];
  console.log('Cached module:', !!electronModuleObject);
  if (electronModuleObject) {
    console.log('Module exports type:', typeof electronModuleObject.exports);
  }
} catch (e) {
  console.log('Error:', e.message);
}

setTimeout(() => process.exit(0), 1000);
