#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building for pkg...');

// First, build TypeScript to ES modules
console.log('Building TypeScript...');
execSync('npm run build:ts', { stdio: 'inherit' });

// Create dist-pkg directory
const distPkgDir = path.join(__dirname, '..', 'dist-pkg');
if (!fs.existsSync(distPkgDir)) {
  fs.mkdirSync(distPkgDir, { recursive: true });
}

// Create a CommonJS wrapper
const wrapperContent = `#!/usr/bin/env node

// CommonJS wrapper for pkg
const path = require('path');

// Override import.meta.url for bundled environment
if (!global.__importMetaUrl) {
  global.__importMetaUrl = require('url').pathToFileURL(__filename).href;
}

// Load the ES module using dynamic import
(async () => {
  try {
    await import('../dist/index.js');
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
})();
`;

fs.writeFileSync(path.join(distPkgDir, 'index.js'), wrapperContent);

// Create package.json for CommonJS context
const pkgJsonContent = {
  "type": "commonjs"
};

fs.writeFileSync(
  path.join(distPkgDir, 'package.json'), 
  JSON.stringify(pkgJsonContent, null, 2)
);

console.log('Build preparation complete. Ready for pkg.');