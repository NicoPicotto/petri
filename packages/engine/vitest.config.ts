/**
 * Dos suites: `pnpm test` (rápida) y `pnpm test:slow` (corridas largas con
 * varios tamaños o muchas semillas; archivos *.slow.test.ts).
 */
import { configDefaults, defineConfig } from 'vitest/config';

const slow = process.env.PETRI_SLOW === '1';

export default defineConfig({
  test: {
    include: slow ? ['test/**/*.slow.test.ts'] : ['test/**/*.test.ts'],
    exclude: slow ? [...configDefaults.exclude] : [...configDefaults.exclude, 'test/**/*.slow.test.ts'],
  },
});
