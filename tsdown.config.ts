import { defineConfig } from 'tsdown'

// Host 半区: 普通 ESM, DSH 运行时提供的包全部走外部解析.
export default defineConfig({
  entry: 'src/index.ts',
  format: ['esm'],
  platform: 'node',
  outDir: 'lib',
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  fixedExtension: false,
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-brand',
      '@deepseek-ai/dsh-commands',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/schemastery',
    ],
  },
})
