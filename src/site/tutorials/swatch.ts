/**
 * Colour swatches for tutorial pages. Every hex colour written as a code span
 * (`#F2E4C6`) becomes a button showing the colour that copies the code, and an
 * intro list made only of named colours renders as a swatch panel.
 */

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function isHexColor(code: string): boolean {
  return HEX_COLOR.test(code);
}

/** `hex` must already pass `isHexColor`, so it needs no escaping. */
function swatchAttrs(hex: string): string {
  return `type="button" data-copy="${hex}" title="Copy ${hex}" style="--swatch: ${hex}"`;
}

export function renderSwatch(hex: string): string {
  return `<button ${swatchAttrs(hex)} class="swatch"><code>${hex}</code></button>`;
}

function renderPaletteSwatch(hex: string): string {
  return `<button ${swatchAttrs(hex)} class="swatch-tile"><code>${hex}</code></button>`;
}

/** One tile of a palette panel: a name, one or more colours, and an optional note. */
export interface PaletteGroup {
  /** Inline Markdown. */
  label: string;
  colors: string[];
  /** The colours were written as a `→` ramp, so they render as one continuous strip. */
  isRamp: boolean;
  /** Inline Markdown, possibly empty. */
  note: string;
}

const CODE = '`#[0-9A-Fa-f]{3,8}`';
const SEPARATOR = '\\s*(?:→|->|/|,|and|or|&)\\s*';
const GROUP = new RegExp(`^([^\`]*?)\\s*:?\\s*(${CODE}(?:${SEPARATOR}${CODE})*)([^\`]*)$`);
const LABEL_MAX = 40;
/** A label like "with darker bars in" means the item is prose, not a list of named colours. */
const CONNECTOR = /^(?:with|plus|in|for|and|or|to|then|from)\b/i;

function parseGroup(text: string): PaletteGroup | null {
  const match = GROUP.exec(text.trim());
  if (!match) return null;
  const label = (match[1] ?? '').trim().replace(/:$/, '').trim();
  const codes = match[2] ?? '';
  const colors = [...codes.matchAll(/`(#[0-9A-Fa-f]+)`/g)].map((m) => m[1] ?? '');
  if (!label || label.length > LABEL_MAX || !colors.every(isHexColor)) return null;
  if (label.includes(':') || CONNECTOR.test(label)) return null;
  const separators = codes.split(/`#[0-9A-Fa-f]+`/).slice(1, -1).map((s) => s.trim());
  const note = (match[3] ?? '').trim().replace(/^[,;—–-]\s*/, '').replace(/^\((.*)\)$/, '$1').trim();
  return {
    label,
    colors,
    isRamp: colors.length > 1 && separators.every((s) => s === '→' || s === '->'),
    note,
  };
}

/**
 * Parses a palette list item such as `Paper `#F2E4C6`, cream ink `#F7ECD3`` or
 * `Sky: `#0E2446` → `#E8605A``. Returns null when the item is anything else,
 * so ordinary lists that happen to mention a colour render as lists.
 */
export function parsePaletteItem(item: string): PaletteGroup[] | null {
  if (!item.includes('`#')) return null;
  const parts: string[] = [];
  const pieces = item.split(/(?<=[`)])(\s*,\s+(?:and\s+)?|\s+and\s+)/);
  for (let i = 0; i < pieces.length; i += 2) {
    const part = pieces[i] ?? '';
    const separator = pieces[i - 1] ?? '';
    const isNote = !part.includes('`#') && separator.includes(',');
    if (parts.length > 0 && (part.trim().startsWith('`#') || isNote)) {
      parts[parts.length - 1] += `, ${part}`;
    } else {
      parts.push(part);
    }
  }
  const groups = parts.map(parseGroup);
  return groups.every((g): g is PaletteGroup => g !== null) ? groups : null;
}

/**
 * Intro lists where every item holds a colour code are meant as palettes.
 * Returns the items that stop such a list rendering as a swatch panel.
 */
export function unparsedPaletteItems(markdown: string): string[] {
  const unparsed: string[] = [];
  for (const block of markdown.split(/\n\s*\n/)) {
    if (!/^[-*]\s/.test(block.trim())) continue;
    const items = block
      .trim()
      .split(/\n(?=[-*]\s)/)
      .map((item) => item.replace(/^[-*]\s+/, '').replace(/\s*\n\s*/g, ' ').trim());
    if (!items.every((item) => item.includes('`#'))) continue;
    unparsed.push(...items.filter((item) => !parsePaletteItem(item)));
  }
  return unparsed;
}

export function renderPaletteGroup(group: PaletteGroup, renderInline: (markdown: string) => string): string {
  const colorClass = group.isRamp ? 'palette-colors is-ramp' : 'palette-colors';
  const note = group.note ? `<span class="palette-note">${renderInline(group.note)}</span>` : '';
  return `<li class="palette-group" style="--colors: ${group.colors.length}">
<span class="palette-label">${renderInline(group.label)}</span>
<div class="palette-body"><div class="${colorClass}">${group.colors.map(renderPaletteSwatch).join('')}</div>${note}</div>
</li>`;
}

/**
 * Copies a swatch's code on click and replays the "Copied" bubble. Inlined
 * once per page that has swatches; the pages carry no other JavaScript.
 */
export const SWATCH_SCRIPT = `<script>
(function () {
  var status = document.createElement('span');
  status.className = 'visually-hidden';
  status.setAttribute('role', 'status');
  document.body.appendChild(status);

  function copyWithSelection(text) {
    var field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.className = 'visually-hidden';
    document.body.appendChild(field);
    field.select();
    var isCopied = false;
    try { isCopied = document.execCommand('copy'); } catch (e) { isCopied = false; }
    document.body.removeChild(field);
    return isCopied;
  }

  function showCopied(button, text) {
    button.classList.remove('is-copied');
    void button.offsetWidth;
    button.classList.add('is-copied');
    status.textContent = '';
    setTimeout(function () { status.textContent = 'Copied ' + text; }, 50);
  }

  document.addEventListener('click', function (event) {
    var button = event.target instanceof Element ? event.target.closest('[data-copy]') : null;
    if (!button) return;
    var text = button.getAttribute('data-copy');
    var onFallback = function () { if (copyWithSelection(text)) showCopied(button, text); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showCopied(button, text); }, onFallback);
    } else {
      onFallback();
    }
  });

  document.addEventListener('animationend', function (event) {
    if (event.animationName === 'swatch-copied') event.target.classList.remove('is-copied');
  });
})();
</script>`;
