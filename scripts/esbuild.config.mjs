import * as esbuild from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  // CJS avoids "Dynamic require is not supported" from google-auth / transitive deps in ESM bundles.
  format: 'cjs',
  minify: true,
  legalComments: 'none',
  logLevel: 'info',
};

await esbuild.build({
  ...common,
  entryPoints: ['src/appraisal.ts'],
  outfile: 'dist/appraisal.cjs',
});
