/**
 * Ask the chat widget to open.
 *
 * A one-line event dispatch, but it lives in its own module rather than being
 * exported from ChatWidget: the widget is lazy-loaded now, and importing this
 * helper from it would drag the whole widget back into the bundle it was split
 * out of. Nothing here needs the widget to exist — if it has not mounted yet
 * the event is simply not heard, which is the correct behaviour for a click
 * that happens before the page has settled.
 */
export function openForgeChat(message) {
  window.dispatchEvent(new CustomEvent('forge:chat:open', { detail: { message } }));
}
