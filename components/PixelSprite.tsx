import React from 'react';
import Svg, { Rect } from 'react-native-svg';

// Chunky 16x16 pixel-art sprites for FREE TIME blocks. Charcoal ('#') with grey
// shading ('g'), flat — no gradients. Rendered as crisp SVG rects at integer
// scales so pixels never blur.
const COLORS: Record<string, string> = { '#': '#2D2D2D', g: '#8A8480', l: '#BDB8B2' };

export type PixelGrid = string[];

export const GUITAR_GRID: PixelGrid = [
  '......####......',
  '......#gg#......',
  '......####......',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '....########....',
  '...#gggggggg#...',
  '...#ggg##ggg#...',
  '....#gggggg#....',
  '....#gggggg#....',
  '...#gggggggg#...',
  '..#gggggggggg#..',
  '..#gggggggggg#..',
  '...#gggggggg#...',
  '....########....',
];

export const DUMBBELL_GRID: PixelGrid = [
  '................',
  '................',
  '................',
  '..###......###..',
  '..#g#......#g#..',
  '###g#......#g###',
  '###g#......#g###',
  '###g########g###',
  '###g#gggggg#g###',
  '###g#......#g###',
  '###g#......#g###',
  '..#g#......#g#..',
  '..###......###..',
  '................',
  '................',
  '................',
];

export const BICYCLE_GRID: PixelGrid = [
  '................',
  '................',
  '................',
  '............###.',
  '....###.....#...',
  '.....#......#...',
  '.....#######....',
  '.....#....##....',
  '.####.#...#####.',
  '#...##.#..#.#..#',
  '#.g#.#..#.#.#..#',
  '#..g.#...##..g.#',
  '#....#...g#....#',
  '.####......####.',
  '................',
  '................',
];

export const BOOK_GRID: PixelGrid = [
  '................',
  '................',
  '................',
  '..############..',
  '..#gggg##gggg#..',
  '..#g########g#..',
  '..#gggg##gggg#..',
  '..#g########g#..',
  '..#gggg##gggg#..',
  '..#g########g#..',
  '..#gggg##gggg#..',
  '..#gggg##gggg#..',
  '..############..',
  '................',
  '................',
  '................',
];

export function PixelSprite({ grid, scale = 2 }: { grid: PixelGrid; scale?: number }) {
  const size = grid.length * scale;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${grid.length} ${grid.length}`}>
      {grid.flatMap((row, y) =>
        row.split('').map((ch, x) =>
          COLORS[ch] ? <Rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={COLORS[ch]} {...({ shapeRendering: 'crispEdges' } as object)} /> : null,
        ),
      )}
    </Svg>
  );
}
