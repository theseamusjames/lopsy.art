/**
 * Sets `name: value` in a Markdown file's leading `---` frontmatter block,
 * replacing the field's line if present and appending it otherwise. Returns
 * null when the source has no frontmatter block.
 */
export function setFrontmatterField(source: string, name: string, value: string): string | null {
  const lines = source.split('\n');
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end === -1) return null;

  const line = `${name}: ${value}`;
  const existing = lines.findIndex((l, i) => i > 0 && i < end && l.startsWith(`${name}:`));
  if (existing === -1) lines.splice(end, 0, line);
  else lines[existing] = line;
  return lines.join('\n');
}
