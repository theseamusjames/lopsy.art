import { LoaderCircle } from 'lucide-react';
import { GoogleG } from '../../icons/GoogleG';
import { Modal } from '../Modal/Modal';
import { StepArt, type Step } from '../StepArt/StepArt';
import styles from './GetStarted.module.css';

interface StepWords {
  readonly step: Step;
  readonly name: string;
  readonly words: string;
}

const STEPS: readonly StepWords[] = [
  {
    step: 'connect',
    name: 'Connect with Google',
    words: 'Photonamous will only have access to a single folder that it creates on your Google Drive, nothing else.',
  },
  {
    step: 'upload',
    name: 'Upload your photos',
    words: 'Import your RAW, DNG, JPG or other common photo types. They’re stored on your Google Drive, never anyplace else.',
  },
  {
    step: 'edit',
    name: 'Edit and export',
    words: 'Use Photonamous to create professional edits of your photos and export them from the browser.',
  },
];

interface GetStartedProps {
  /** Google's sign-in is under way. */
  readonly connecting: boolean;
  /** Why the last try failed, said under the button. */
  readonly error: string | null;
  readonly onSignIn: () => void;
  readonly onClose: () => void;
}

/**
 * What a new visitor sees after "Try it now": the three steps from here
 * to an edited photo, each with a drawing, and under them the way in,
 * Continue with Google.
 */
export function GetStarted({ connecting, error, onSignIn, onClose }: GetStartedProps) {
  return (
    <Modal title="How it works" width="xl" onClose={onClose}>
      <ol className={styles.steps}>
        {STEPS.map(({ step, name, words }, index) => (
          <li key={step} className={styles.step}>
            <div className={styles.art}>
              <StepArt step={step} />
            </div>
            <div className={styles.text}>
              <h3 className={styles.name}>
                <span className={styles.number}>Step {index + 1}</span>
                {name}
              </h3>
              <p className={styles.words}>{words}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className={styles.signIn}>
        <button type="button" className={styles.google} disabled={connecting} onClick={onSignIn} data-autofocus>
          {connecting ? <LoaderCircle size={18} className={styles.spin} /> : <GoogleG />}
          Continue with Google
        </button>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <p className={styles.fine}>
          Google will ask you one thing: to let Photonamous use the files it creates in your Drive.
          <br />
          No email or name required.
        </p>
      </div>
    </Modal>
  );
}
