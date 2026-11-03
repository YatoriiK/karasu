import type { Look, Wallpaper } from "../theme/look";

export type FrameStyle = "inherit" | "bar" | "line" | "none";
export type ShadowStyle = "inherit" | "none" | "soft" | "hard" | "glow";

export type ItemStyle = {
  titlebar?: FrameStyle;
  bg?: "inherit" | "none" | "color" | "image";
  bgColor?: string;
  bgImage?: string | null;
  bgFit?: "cover" | "contain";
  bgDim?: number;
  opacity?: number;
  surface?: number;
  blur?: number;
  border?: number;
  borderColor?: string;
  borderStyle?: "solid" | "dashed" | "dotted" | "double";
  radius?: number;
  shadow?: ShadowStyle;
  font?: string;
  scale?: number;
  color?: string;
  padding?: number;
};

export type Item = {
  id: string;
  kind: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  z: number;
  hidden?: boolean;
  locked?: boolean;
  style: ItemStyle;
  props: Record<string, unknown>;
};

export type DeskData = {
  canvas: { w: number; h: number };
  grid: number;
  snap?: boolean;
  wallpaper: Wallpaper | null;
  look?: Look | null;
  items: Item[];
};

export type Layout = {
  id: number;
  name: string;
  pos: number;
  updated: string;
  data: DeskData;
};

export type Rect = { x: number; y: number; w: number; h: number; r: number };

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
