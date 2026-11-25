import { createLucideIcon } from 'lucide-react';

/**
 * A picture with an × at its corner: Set aside. Lucide has image-plus and
 * image-minus but no image-x, so this is image-plus's frame with an × in
 * place of the plus, drawn by Lucide's own helper so it takes the same
 * props and stroke as every other icon. The eye stays for showing and
 * hiding (Before, the masks).
 */
export const ImageX = createLucideIcon('image-x', [
  ['path', { d: 'm16.5 2.5 5 5', key: 'cross-a' }],
  ['path', { d: 'm21.5 2.5-5 5', key: 'cross-b' }],
  ['path', { d: 'M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5', key: 'frame' }],
  ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21', key: 'hill' }],
  ['circle', { cx: '9', cy: '9', r: '2', key: 'sun' }],
]);
