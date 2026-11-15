import type { Preview } from '@storybook/react-vite';
import '../src/styles/tokens.css';
import '../src/styles/reset.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'app',
      values: [
        { name: 'app', value: 'var(--color-bg-primary)' },
        { name: 'panel', value: 'var(--color-bg-secondary)' },
      ],
    },
  },
};

export default preview;
