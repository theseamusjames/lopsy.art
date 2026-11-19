import type { StorybookConfig } from '@storybook/react-vite';

/** Lopsy Photos' components, on the same Storybook setup as lopsy-web. */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  typescript: {
    reactDocgen: 'react-docgen-typescript',
  },
  // The app's service worker has no place in Storybook.
  viteFinal: (vite) => ({
    ...vite,
    plugins: (vite.plugins ?? []).flat().filter((p) => !(p && typeof p === 'object' && 'name' in p && p.name === 'photonamous-service-worker')),
  }),
};

export default config;
