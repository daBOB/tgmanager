#!/usr/bin/env node

const esbuild = require('esbuild');
const path = require('path');

async function bundle() {
  try {
    console.log('Bundling for pkg...');
    
    // Bundle the TypeScript/ES modules into a single CommonJS file
    await esbuild.build({
      entryPoints: [path.join(__dirname, '..', 'dist', 'index.js')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: path.join(__dirname, '..', 'dist-pkg', 'bundled.cjs'),
      external: [
        // Native modules that can't be bundled
        'fluent-ffmpeg',
      ],
      // Handle import.meta.url
      define: {
        'import.meta.url': 'importMetaUrl',
      },
      banner: {
        js: `
const importMetaUrl = typeof __filename !== 'undefined' ? require('url').pathToFileURL(__filename).href : '';
        `.trim()
      },
      minify: false,
      sourcemap: false,
      // Resolve telegram modules correctly
      mainFields: ['main', 'module'],
      conditions: ['node', 'default'],
      resolveExtensions: ['.js', '.json', '.node'],
    });
    
    console.log('Bundle created successfully!');
  } catch (error) {
    console.error('Bundle failed:', error);
    process.exit(1);
  }
}

bundle();