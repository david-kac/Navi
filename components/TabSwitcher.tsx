import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Borders, Fonts, FontSizes } from '../constants/theme';

export type Tab = 'DAY' | 'WEEK' | 'CATS';
const TABS: Tab[] = ['DAY', 'WEEK', 'CATS'];

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const INK = Colors.ink;
const BG  = Colors.background;

export default function TabSwitcher({ active, onChange }: Props) {
  return (
    <View style={s.wrap}>
      <View style={s.bar}>
        {TABS.map((tab, i) => (
          <TouchableOpacity
            key={tab}
            style={[s.tab, i > 0 && s.div, active === tab && s.on]}
            onPress={() => onChange(tab)}
            activeOpacity={0.8}
          >
            <Text style={[s.label, active === tab && s.labelOn]}>{tab}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:    { paddingHorizontal: 18, marginBottom: 10 },
  bar:     { flexDirection: 'row', borderWidth: Borders.card.borderWidth, borderColor: INK, borderRadius: Borders.radius, overflow: 'hidden' },
  tab:     { flex: 1, paddingVertical: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: BG },
  div:     { borderLeftWidth: Borders.card.borderWidth, borderLeftColor: INK },
  on:      { backgroundColor: INK },
  label:   { fontFamily: Fonts.ui, fontSize: FontSizes.sectionHeader, color: INK, lineHeight: 10 },
  labelOn: { color: BG },
});
