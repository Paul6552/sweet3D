/** Mausrad-Ausschlag in Pixeln, auch wenn der Browser Zeilen (Firefox) oder Seiten meldet. */
export function wheelDelta(event: WheelEvent, pageHeight = 800): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return event.deltaY * 16
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return event.deltaY * pageHeight
  return event.deltaY
}
