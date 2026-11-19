import type { ReactNode } from 'react';
import { Cloud, Folder, LoaderCircle, Monitor } from 'lucide-react';
import type { ReconnectOffer, StorageChoice } from '../../app/backend';
import { Button } from '../Button/Button';
import styles from './StartScreen.module.css';

interface Choice {
  readonly title: string;
  readonly detail: string;
  readonly icon: ReactNode;
}

const CHOICES: Record<StorageChoice, Choice> = {
  'google-drive': {
    title: 'Google Drive',
    detail: 'Your photos are kept in your own Google Drive. Every computer you sign in on sees the same library.',
    icon: <Cloud size={22} />,
  },
  browser: {
    title: 'This browser',
    detail: 'Private storage inside this browser, on this computer only. Clearing the browser’s data removes it.',
    icon: <Monitor size={22} />,
  },
  'local-folder': {
    title: 'A folder on this computer',
    detail: 'Pick a folder. Your photos and the library are kept there as ordinary files you can back up.',
    icon: <Folder size={22} />,
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
      return `Continue as ${offer.label}`;
  }
}

export function StartScreen({ choices, offer, connecting, error, onChoose, onReconnect, busyKind, onTakeOver, receiving }: StartScreenProps) {
  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <h1 className={styles.brand}>Lopsy Photos</h1>
        <p className={styles.lead}>
          Keep all your photos in one place, pick out the best ones and edit them, while the files you took stay
          exactly as they were.
        </p>
        <p className={styles.lead}>Your photos are stored where you choose, never on Lopsy’s servers.</p>

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

        {offer && !busyKind && (
          <div className={styles.reopen}>
            <Button variant="primary" size="lg" disabled={connecting !== null} onClick={() => onReconnect(offer)}>
              {connecting === offer.kind ? <LoaderCircle size={16} className={styles.spin} /> : CHOICES[offer.kind].icon}
              {reopenWords(offer)}
            </Button>
          </div>
        )}

        <h2 className={styles.question}>{offer ? 'Or choose where your library lives' : 'Where should your library live?'}</h2>
        <ul className={styles.choices}>
          {choices.map((kind) => {
            const c = CHOICES[kind];
            const busy = connecting === kind;
            return (
              <li key={kind}>
                <button
                  type="button"
                  className={styles.choice}
                  disabled={connecting !== null}
                  onClick={() => onChoose(kind)}
                >
                  <span className={styles.icon}>{busy ? <LoaderCircle size={22} className={styles.spin} /> : c.icon}</span>
                  <span className={styles.text}>
                    <span className={styles.title}>{c.title}</span>
                    <span className={styles.detail}>{c.detail}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
