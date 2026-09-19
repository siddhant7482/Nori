/* One toast at a time, raised from anywhere on the client. The frame
 * listens; a server action's result message ends up here. */
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent("nori:toast", { detail: message }));
}
