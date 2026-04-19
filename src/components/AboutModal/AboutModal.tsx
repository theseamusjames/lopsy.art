import styles from './AboutModal.module.css';

interface AboutModalProps {
  onClose: () => void;
}

export function AboutModal({ onClose }: AboutModalProps) {
  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div className={styles.modal} role="dialog" aria-label="About Lopsy" onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.body}>
          <h2 className={styles.title}>Lopsy</h2>
          <p className={styles.description}>
            A free browser-based image editor by Seamus James.
          </p>
          <div className={styles.links}>
            <a className={styles.link} href="https://lopsy.art" target="_blank" rel="noopener noreferrer">
              lopsy.art
            </a>
            <span className={styles.linkSep}>&middot;</span>
            <a className={styles.link} href="https://github.com/theseamusjames/lopsy.art" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </div>
          <textarea
            className={styles.license}
            readOnly
            aria-label="License text"
            rows={8}
            value={`"Commons Clause" License Condition v1.0\n\nThe Software is provided to you by the Licensor under the License, as defined below, subject to the following condition.\n\nWithout limiting other conditions in the License, the grant of rights under the License will not include, and the License does not grant to you, the right to Sell the Software.\n\nFor purposes of the foregoing, "Sell" means practicing any or all of the rights granted to you under the License to provide to third parties, for a fee or other consideration (including without limitation fees for hosting or consulting/support services related to the Software), a product or service whose value derives, entirely or substantially, from the functionality of the Software.\n\nSoftware: Lopsy\nLicense: MIT\nLicensor: Seamus James\n\n---\n\nMIT License\n\nCopyright (c) 2026 Seamus James\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`}
          />
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
