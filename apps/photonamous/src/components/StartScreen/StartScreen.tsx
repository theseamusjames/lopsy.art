import { useState, type ReactNode } from 'react';
import { Cloud, Folder, LoaderCircle, Monitor } from 'lucide-react';
import type { ReconnectOffer, StorageChoice } from '../../app/backend';
import { GitHubMark } from '../../icons/GitHubMark';
import { Button } from '../Button/Button';
import { DemoReel } from '../DemoReel/DemoReel';
import { GetStarted } from '../GetStarted/GetStarted';
import { Wordmark } from '../Wordmark/Wordmark';
import styles from './StartScreen.module.css';

/** Where the code is, for anyone deciding whether to trust the page. */
const SOURCE_URL = 'https://github.com/theseamusjames/lopsy.art';

interface LocalChoice {
  readonly title: string;
  readonly detail: string;
  readonly icon: ReactNode;
}

/** Libraries on this computer: offered by development builds only (app/backend.ts, `storageEnv`). */
const LOCAL: Record<Exclude<StorageChoice, 'google-drive'>, LocalChoice> = {
  browser: {
    title: 'This browser',
    detail: 'Private storage in this browser. Clearing its data removes the library.',
    icon: <Monitor size={18} />,
  },
  'local-folder': {
    title: 'A folder on this computer',
    detail: 'A folder you pick, filled with ordinary files.',
    icon: <Folder size={18} />,
  },
};

interface StartScreenProps {
  choices: readonly StorageChoice[];
  /** The library from the last visit, offered first. */
  offer: ReconnectOffer | null;
  connecting: StorageChoice | null;
  error: string | null;
  onChoose: (choice: StorageChoice) => void;
  onReconnect: (offer: ReconnectOffer) => void;
  /** The library another tab of this browser has open, if opening it was refused for that. */
  busyKind: StorageChoice | null;
  /** Lopsy opened this page to save into the library and is waiting. */
  receiving: boolean;
  onTakeOver: (kind: StorageChoice) => void;
}

function reopenWords(offer: ReconnectOffer): string {
  switch (offer.kind) {
    case 'browser':
      return 'Open your library in this browser';
    case 'local-folder':
      return `Reopen the folder “${offer.label}”`;
    case 'google-drive':
      return 'Open your Google Drive library';
  }
}

function reopenIcon(kind: StorageChoice): ReactNode {
  if (kind === 'google-drive') return <Cloud size={16} />;
  return kind === 'browser' ? <Monitor size={16} /> : <Folder size={16} />;
}

/**
 * The page a visitor lands on. The film fills two thirds of the window;
 * the column on the right keeps the wordmark, one line of what it is and
 * the way in. For a new visitor that is "Try it now", which opens the
 * three steps and Sign in with Google (`GetStarted`); someone who has
 * been here before gets their library back in one press. On a narrow
 * window the two stack.
 */
export function StartScreen({ choices, offer, connecting, error, onChoose, onReconnect, busyKind, onTakeOver, receiving }: StartScreenProps) {
  const hasDrive = choices.includes('google-drive');
  const local = choices.filter((kind) => kind !== 'google-drive');
  const isBusy = connecting !== null;
  const reopening = offer !== null && !busyKind ? offer : null;
  const returningToDrive = reopening?.kind === 'google-drive';
  const [isStarting, setIsStarting] = useState(false);
  /** The steps are open: they say what went wrong, under their own button. */
  const showsSteps = isStarting && hasDrive;

  return (
    <main className={styles.screen}>
      <div className={styles.stage}>
        <DemoReel />
      </div>

      <div className={styles.panel}>
        <div className={styles.body}>
          <h1 className={styles.brand}>
            <Wordmark size="start" />
          </h1>
          <p className={styles.tagline}>Your photos. Your cloud storage. Completely free.</p>

          {receiving && (
            <p className={styles.receiving} role="status">
              Lopsy is waiting to save into your library. Open it to receive the save.
            </p>
          )}

          {busyKind && (
            <div className={styles.busy} role="alert">
              <p>This library is open in another tab. Only one tab can change it at a time.</p>
              <Button variant="primary" onClick={() => onTakeOver(busyKind)}>
                Use it here
              </Button>
              <p className={styles.busyNote}>The other tab stops saving changes and asks to be reloaded.</p>
            </div>
          )}

          <div className={styles.actions}>
            {reopening && (
              <Button variant="primary" size="lg" className={styles.wide} disabled={isBusy} onClick={() => onReconnect(reopening)}>
                {connecting === reopening.kind ? <LoaderCircle size={16} className={styles.spin} /> : reopenIcon(reopening.kind)}
                {reopenWords(reopening)}
              </Button>
            )}

            {hasDrive && returningToDrive && (
              <Button variant="link" disabled={isBusy} onClick={() => onChoose('google-drive')}>
                Use a different Google account
              </Button>
            )}

            {hasDrive && !returningToDrive && (
              <Button variant="primary" size="lg" className={styles.wide} disabled={isBusy} onClick={() => setIsStarting(true)}>
                Try it now
              </Button>
            )}

            {!hasDrive && local.length === 0 && (
              <p className={styles.fine} role="status">
                Google sign-in is not set up in this build, so there is no library to open.
              </p>
            )}
          </div>

          {local.length > 0 && (
            <section className={styles.local} aria-labelledby="start-local">
              <h2 id="start-local" className={styles.localHeading}>
                Development builds only: a library on this computer
              </h2>
              <ul className={styles.localChoices}>
                {local.map((kind) => {
                  const choice = LOCAL[kind];
                  return (
                    <li key={kind}>
                      <button type="button" className={styles.localChoice} disabled={isBusy} onClick={() => onChoose(kind)}>
                        <span className={styles.localIcon}>
                          {connecting === kind ? <LoaderCircle size={18} className={styles.spin} /> : choice.icon}
                        </span>
                        <span className={styles.localText}>
                          <span className={styles.localTitle}>{choice.title}</span>
                          <span className={styles.localDetail}>{choice.detail}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {error && !showsSteps && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>

        <nav className={styles.links} aria-label="About Photonamous">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a className={styles.source} href={SOURCE_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub" title="Source on GitHub">
            <GitHubMark />
          </a>
        </nav>
      </div>

      {showsSteps && (
        <GetStarted
          connecting={connecting === 'google-drive'}
          error={error}
          onSignIn={() => onChoose('google-drive')}
          onClose={() => setIsStarting(false)}
        />
      )}
    </main>
  );
}
