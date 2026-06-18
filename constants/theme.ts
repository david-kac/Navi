import type { TextStyle, ViewStyle } from 'react-native';

// ─── Colors ───────────────────────────────────────────────────────────────────
export const Colors = {
  background: '#FEFEFE', // warm paper cream — every screen bg
  ink:        '#2D2D2D', // charcoal — all borders, primary text
  muted:      '#8A8480', // timestamps, labels, secondary text
} as const;

// ─── Borders ──────────────────────────────────────────────────────────────────
export const Borders = {
  card: {
    borderWidth:  1.354,
    borderStyle:  'solid' as ViewStyle['borderStyle'],
    borderColor:  '#2D2D2D',
    borderRadius: 4,
  },
  verse: {
    borderWidth:  0.677,
    borderStyle:  'dashed' as ViewStyle['borderStyle'],
    borderColor:  '#2D2D2D',
    borderRadius: 4,
  },
  radius: 4,
} as const;

// ─── Fonts ────────────────────────────────────────────────────────────────────
export const Fonts = {
  ui:      'PressStart2P', // labels, headers, chrome
  content: 'VT323',        // task names, body text
} as const;

export const FontSizes = {
  taskName:      18,
  labelSm:        6,
  labelMd:        9,
  sectionHeader:  7,
  body:          14,
} as const;

// ─── Typography presets ───────────────────────────────────────────────────────
const sectionHeader: TextStyle = {
  fontFamily:    Fonts.ui,
  fontSize:      FontSizes.sectionHeader,
  color:         Colors.muted,
  letterSpacing: 2,
  lineHeight:    11,
};

const taskName: TextStyle = {
  fontFamily: Fonts.content,
  fontSize:   FontSizes.taskName,
  color:      Colors.ink,
  lineHeight: 20,
};

const timestamp: TextStyle = {
  fontFamily: Fonts.ui,
  fontSize:   FontSizes.labelSm,
  color:      Colors.muted,
  lineHeight: 9,
};

const labelSm: TextStyle = {
  fontFamily: Fonts.ui,
  fontSize:   FontSizes.labelSm,
  color:      Colors.ink,
  lineHeight: 10,
};

const labelMd: TextStyle = {
  fontFamily: Fonts.ui,
  fontSize:   FontSizes.labelMd,
  color:      Colors.ink,
  lineHeight: 14,
};

const body: TextStyle = {
  fontFamily: Fonts.content,
  fontSize:   FontSizes.body,
  color:      Colors.ink,
  lineHeight: 20,
};

export const Typography = {
  sectionHeader,
  taskName,
  timestamp,
  labelSm,
  labelMd,
  body,
} as const;

// ─── Layout ───────────────────────────────────────────────────────────────────
export const Layout = {
  dotSpriteSize:   60,
  screenPaddingH:  18,
  screenPaddingV:  12,
} as const;

// ─── Convenience re-export ────────────────────────────────────────────────────
export const Theme = {
  colors:    Colors,
  borders:   Borders,
  fonts:     Fonts,
  fontSizes: FontSizes,
  typography: Typography,
  layout:    Layout,
} as const;
