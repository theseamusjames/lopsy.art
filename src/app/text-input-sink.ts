/**
 * The text tool's hidden input sink is a focused <textarea>, but unlike every
 * other text field it must not swallow editor shortcuts: keys aimed at it are
 * routed to the text editor by the global keyboard handler. This attribute is
 * how global handlers tell it apart from real form fields.
 */
export const TEXT_INPUT_SINK_ATTR = 'data-text-input-sink';

export function isTextInputSink(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.hasAttribute(TEXT_INPUT_SINK_ATTR);
}
