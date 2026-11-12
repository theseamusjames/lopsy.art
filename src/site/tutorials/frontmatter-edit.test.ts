import { describe, expect, it } from 'vitest';
import { setFrontmatterField } from './frontmatter-edit';

describe('setFrontmatterField', () => {
  it('replaces an existing field in place', () => {
    const source = '---\ntitle: A\nproject: a.lopsy\ntags: x\n---\nproject: body text stays\n';
    expect(setFrontmatterField(source, 'project', 'tutorials/a/0123456789ab/a.lopsy')).toBe(
      '---\ntitle: A\nproject: tutorials/a/0123456789ab/a.lopsy\ntags: x\n---\nproject: body text stays\n',
    );
  });

  it('appends a missing field at the end of the frontmatter', () => {
    expect(setFrontmatterField('---\ntitle: A\n---\nBody\n', 'project', 'k')).toBe('---\ntitle: A\nproject: k\n---\nBody\n');
  });

  it('does not match a field whose name merely starts the same', () => {
    expect(setFrontmatterField('---\nprojectNote: x\n---\n', 'project', 'k')).toBe('---\nprojectNote: x\nproject: k\n---\n');
  });

  it('returns null without a frontmatter block', () => {
    expect(setFrontmatterField('# Title\n', 'project', 'k')).toBeNull();
    expect(setFrontmatterField('---\ntitle: A\n', 'project', 'k')).toBeNull();
  });
});
