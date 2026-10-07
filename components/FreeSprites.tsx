import React from 'react';
import { Image } from 'react-native';
import { PixelSprite, GUITAR_GRID, DUMBBELL_GRID, BICYCLE_GRID, BOOK_GRID } from './PixelSprite';

// Pool of pixel-art icons for FREE TIME blocks. Each entry renders at an
// integer pixel scale. Picked per block deterministically (see pickFreeSprite).
// Ocarina is a 208x179 PNG whose art pixels are 8px; shown at 1/4 scale so each
// art pixel lands on a whole 2px block.
const OCARINA = require('../assets/ocarina.png');

export const FREE_SPRITES: { id: string; render: () => React.ReactElement }[] = [
  { id: 'ocarina',  render: () => <Image source={OCARINA} style={{ width: 52, height: 44.75 }} resizeMode="contain" fadeDuration={0} /> },
  { id: 'guitar',   render: () => <PixelSprite grid={GUITAR_GRID}   scale={3} /> },
  { id: 'dumbbell', render: () => <PixelSprite grid={DUMBBELL_GRID} scale={3} /> },
  { id: 'bicycle',  render: () => <PixelSprite grid={BICYCLE_GRID}  scale={3} /> },
  { id: 'book',     render: () => <PixelSprite grid={BOOK_GRID}     scale={3} /> },
];

/** Same gap start time -> same icon, every render. */
export function pickFreeSprite(startMin: number) {
  return FREE_SPRITES[Math.floor(startMin / 5) % FREE_SPRITES.length];
}
