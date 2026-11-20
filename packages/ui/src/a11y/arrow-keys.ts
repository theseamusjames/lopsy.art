/**
 * Marks a control that handles the arrow keys itself. An app whose
 * shortcuts listen in the capture phase, as Lopsy's arrow-key nudge does,
 * hears a key before the focused control, so the control's own
 * stopPropagation cannot hold the key back: such a handler looks for this
 * attribute on the target and leaves the key alone. Set it with
 * `{...{ [HANDLES_ARROW_KEYS_ATTR]: '' }}`.
 */
export const HANDLES_ARROW_KEYS_ATTR = 'data-handles-arrow-keys';
