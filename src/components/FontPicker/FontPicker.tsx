import { useState, useEffect, useRef, useCallback } from 'react';
import {
  type GoogleFont,
  getGoogleFontList,
  getPreviewUrl,
  fontFamilyCssValue,
  loadGoogleFont,
  extractFontName,
} from '../../utils/google-font-loader';
import styles from './FontPicker.module.css';

interface FontPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [fonts, setFonts] = useState<GoogleFont[]>([]);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && fonts.length === 0) {
      getGoogleFontList().then(setFonts).catch(() => {});
    }
  }, [isOpen, fonts.length]);

  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setSearch('');
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  const handleSelect = useCallback(
    (font: GoogleFont) => {
      const cssValue = fontFamilyCssValue(font.family, font.category);
      loadGoogleFont(font.family);
      onChange(cssValue);
      setIsOpen(false);
      setSearch('');
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setSearch('');
      }
    },
    [],
  );

  const filtered = search
    ? fonts.filter((f) =>
        f.family.toLowerCase().includes(search.toLowerCase()),
      )
    : fonts;

  const currentName = extractFontName(value);

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        className={styles.trigger}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        {currentName}
      </button>
      {isOpen && (
        <div className={styles.dropdown} onKeyDown={handleKeyDown}>
          <input
            ref={searchRef}
            className={styles.search}
            type="text"
            placeholder="Search fonts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className={styles.list}>
            {filtered.map((font) => {
              const isActive = font.family === currentName;
              const className = isActive
                ? `${styles.item} ${styles.itemActive}`
                : styles.item;

              return (
                <button
                  key={font.family}
                  className={className}
                  onClick={() => handleSelect(font)}
                  type="button"
                >
                  <img
                    src={getPreviewUrl(font.family)}
                    alt={font.family}
                    loading="lazy"
                    className={styles.preview}
                    onError={(e) => {
                      const target = e.currentTarget;
                      const span = document.createElement('span');
                      span.className = styles.fallbackLabel;
                      span.textContent = font.family;
                      target.replaceWith(span);
                    }}
                  />
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className={styles.empty}>No fonts found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
