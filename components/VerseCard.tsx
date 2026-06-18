import { View, Text, StyleSheet } from 'react-native';
import { getVerseOfDay } from '../constants/verses';
import { Colors, Borders, Fonts, FontSizes } from '../constants/theme';

const OLIVE  = '#7A8B5A';
const INK    = Colors.ink;
const MUTED  = Colors.muted;

export default function VerseCard() {
  const verse = getVerseOfDay();
  return (
    <View style={s.card}>
      <Text style={[s.corner, s.tl]}>✦</Text>
      <Text style={[s.corner, s.tr]}>✦</Text>
      <Text style={[s.corner, s.bl]}>✦</Text>
      <Text style={[s.corner, s.br]}>✦</Text>
      <View style={s.body}>
        <Text style={s.label}>VERSE</Text>
        <Text style={s.text}>"{verse.text}"</Text>
        <Text style={s.ref}>— {verse.reference}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card:   { marginHorizontal: 18, marginTop: 14, marginBottom: 6, borderWidth: Borders.verse.borderWidth, borderStyle: 'dashed', borderColor: INK, borderRadius: Borders.radius, paddingHorizontal: 18, paddingVertical: 16 },
  corner: { position: 'absolute', fontFamily: Fonts.ui, fontSize: 8, color: OLIVE, lineHeight: 10 },
  tl:     { top: 6, left: 8 },
  tr:     { top: 6, right: 8 },
  bl:     { bottom: 6, left: 8 },
  br:     { bottom: 6, right: 8 },
  body:   { paddingHorizontal: 6, paddingVertical: 4 },
  label:  { fontFamily: Fonts.ui, fontSize: FontSizes.labelSm, color: MUTED, lineHeight: 10, letterSpacing: 0.5, marginBottom: 8 },
  text:   { fontFamily: Fonts.content, fontSize: 17, color: INK, lineHeight: 22, marginBottom: 6 },
  ref:    { fontFamily: Fonts.ui, fontSize: FontSizes.labelSm, color: MUTED, lineHeight: 10 },
});
