import preset from '@fv/tokens/tailwind-preset';

/**
 * NOTE — the preset is imported from another workspace package, and Tailwind
 * only watches THIS file, not the module graph behind it. Editing
 * `packages/tokens/src/tailwind-preset.js` while `pnpm dev` is running leaves
 * the dev server generating the old utility set: new classes silently produce
 * no CSS at all, so an icon renders with no background and a layout loses its
 * sidebar offset while the markup looks perfectly correct.
 *
 * Restart the dev server after touching the preset. (`globals.css` is a real
 * CSS import and does hot-reload — it is only the config that goes stale.)
 */

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  darkMode: 'class',
  // Only this app renders markup. `packages/*` hold logic and tokens, no JSX,
  // so scanning them would just walk node_modules for nothing.
  content: ['./index.html', './src/**/*.{ts,tsx}'],
};
