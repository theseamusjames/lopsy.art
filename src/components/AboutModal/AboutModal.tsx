import styles from './AboutModal.module.css';

interface AboutModalProps {
  onClose: () => void;
}

export function AboutModal({ onClose }: AboutModalProps) {
  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.modal} onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.body}>
          <h2 className={styles.title}>Lopsy</h2>
          <p className={styles.description}>
            A browser-based image editor.
          </p>
          <a className={styles.link} href="https://lopsy.art" target="_blank" rel="noopener noreferrer">
            lopsy.art
          </a>
        </div>
        <div className={styles.footer}>
          <button className={styles.closeButton} onClick={onClose} type="button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
