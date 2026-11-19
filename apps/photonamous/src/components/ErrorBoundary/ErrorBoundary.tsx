import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../Button/Button';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The last line of defence: an error while rendering shows a plain message
 * with Reload instead of a blank page. The library is saved as it changes,
 * so reloading loses nothing that was saved.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Lopsy Photos stopped rendering', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={styles.screen} role="alert">
        <h1 className={styles.title}>Something went wrong</h1>
        <p className={styles.text}>Lopsy Photos hit a problem it could not recover from. Your library is saved as you work; reloading opens it again.</p>
        <p className={styles.detail}>{error.message}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}
