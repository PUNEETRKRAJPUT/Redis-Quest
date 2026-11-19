/**
 * A panel is either a fixed number of pixels tall or fills its parent ('fill': the parent must have a definite
 * height, for example a pane of the level workbench).
 */
export type PanelHeight = number | 'fill';

export function cssHeight(height: PanelHeight): number | string {
  return height === 'fill' ? '100%' : height;
}
