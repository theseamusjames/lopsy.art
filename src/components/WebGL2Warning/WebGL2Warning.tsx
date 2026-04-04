import styles from './WebGL2Warning.module.css';

function detectBrowser(): 'chrome' | 'firefox' | 'safari' | 'edge' | 'other' {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Chrome/')) return 'chrome';
  if (ua.includes('Firefox/')) return 'firefox';
  if (ua.includes('Safari/')) return 'safari';
  return 'other';
}

interface BrowserInstructions {
  name: string;
  steps: string[];
}

const INSTRUCTIONS: Record<ReturnType<typeof detectBrowser>, BrowserInstructions> = {
  chrome: {
    name: 'Chrome',
    steps: [
      'Open a new tab and go to chrome://settings/system',
      'Enable "Use hardware acceleration when available"',
      'Click "Relaunch" to restart Chrome',
      'Return to this page',
    ],
  },
  edge: {
    name: 'Edge',
    steps: [
      'Open a new tab and go to edge://settings/system',
      'Enable "Use hardware acceleration when available"',
      'Click "Restart" to relaunch Edge',
      'Return to this page',
    ],
  },
  firefox: {
    name: 'Firefox',
    steps: [
      'Open a new tab and go to about:config',
      'Accept the risk warning if prompted',
      'Search for webgl.disabled',
      'Double-click the preference to set it to false',
      'Reload this page',
    ],
  },
  safari: {
    name: 'Safari',
    steps: [
      'Open Safari menu → Settings → Advanced',
      'Check "Show features for web developers"',
      'Open the Develop menu → Feature Flags',
      'Ensure "WebGL 2.0" is enabled',
      'Reload this page',
    ],
  },
  other: {
    name: 'your browser',
    steps: [
      'Check that hardware acceleration is enabled in your browser settings',
      'Make sure your graphics drivers are up to date',
      'Try a different browser such as Chrome or Firefox',
    ],
  },
};

export function checkWebGL2Support(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export function WebGL2Warning() {
  const browser = detectBrowser();
  const { name, steps } = INSTRUCTIONS[browser];

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.heading}>
          <div className={styles.icon}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h1 className={styles.title}>WebGL 2 is not available</h1>
        </div>
        <p className={styles.description}>
          Lopsy requires WebGL 2 for GPU-accelerated rendering. It appears to be
          disabled or unsupported in {name}.
        </p>
        <div className={styles.instructions}>
          <p className={styles.instructionsLabel}>To enable WebGL 2 in {name}:</p>
          <ol className={styles.steps}>
            {steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </div>
        <p className={styles.fallback}>
          If the issue persists, try updating {name} to the latest version or
          switch to a recent version of Chrome, Firefox, or Edge.
        </p>
      </div>
    </div>
  );
}
