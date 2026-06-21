export type Orientation = "landscape" | "portrait";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  orientation: Orientation;
}

export interface OverlayFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  zoom: number;
}
