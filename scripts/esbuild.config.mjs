import * as esbuild from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
};

await esbuild.build({
  ...common,
  entryPoints: ['src/appraisal.ts'],
  outfile: 'dist/appraisal.js',
});
