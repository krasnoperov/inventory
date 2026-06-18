/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: ['src/frontend/components/**/*.stories.{ts,tsx}'],
  outDir: 'build/ladle',
  viteConfig: 'vite.ladle.config.ts',
  addons: {
    // Our colors switch via CSS `color-scheme` + `light-dark()`, not a class
    // toggle, so Ladle's built-in theme addon can't drive them. The
    // style-reference capture spec forces color-scheme per theme instead.
    theme: {
      enabled: false,
    },
    // Viewport presets matching the style-reference screenshot matrix.
    width: {
      enabled: true,
      options: {
        mobile: 375,
        tablet: 900,
        desktop: 1280,
      },
      defaultState: 0,
    },
    a11y: {
      enabled: true,
    },
    msw: {
      enabled: false,
    },
  },
};
