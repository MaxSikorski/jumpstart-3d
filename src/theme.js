// Colors for the 3D view in each interface theme. Grid colors are shown exactly as written
// (the grid shader does no color conversion). The page chrome uses CSS
// variables; WebGL needs numbers, so they live here and update together.
export const THEMES = {
  light: {
    bg: "#e6eaee", wpBg: "#f2f4f6",
    wp: { bg: "#b5d0ed", minor: "#658dc2", major: "#295092" },
    lines: { bg: "#ffffff", minor: "#8b9aaa", major: "#506072" },
    sketch: 0x22303f, sketchFill: 0x8fb4ea, edge: 0x1b2129, edgeOpacity: 0.55, accent: 0x1f4fa8, hover: 0xe8a317,
  },
  dark: {
    bg: "#151a20", wpBg: "#12161b",
    wp: { bg: "#34485f", minor: "#55708f", major: "#86a6cc" },
    lines: { bg: "#2b333d", minor: "#4f5b68", major: "#8693a1", alpha: 0.92 },
    sketch: 0xffe600, sketchFill: 0xd0d5db, edge: 0x0b0e12, edgeOpacity: 0.75, accent: 0x7aa7ff, hover: 0xffb43a,
  },
  contrast: {
    bg: "#000000", wpBg: "#000000",
    wp: { bg: "#00172e", minor: "#3d6a99", major: "#8fbcef" },
    lines: { bg: "#000000", minor: "#5c5c5c", major: "#b3b3b3" },
    sketch: 0xffe600, sketchFill: 0xe0e0e0, edge: 0x000000, edgeOpacity: 1, accent: 0xffd400, hover: 0x00e5ff,
  },
};
export const theme = { name: "light", c: THEMES.light };
export function setThemeColors(name) {
  theme.name = THEMES[name] ? name : "light";
  theme.c = THEMES[theme.name];
}
