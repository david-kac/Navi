import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react-native';
import { Colors, Fonts, FontSizes } from '../constants/theme';

const INK = Colors.ink;

interface Props {
  date: Date;
  onPrev: () => void;
  onNext: () => void;
  onCalendar: () => void;
}

export default function DateNav({ date, onPrev, onNext, onCalendar }: Props) {
  const label = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <View style={s.row}>
      <TouchableOpacity style={s.btn} onPress={onPrev}>
        <ChevronLeft size={14} color={INK} strokeWidth={2} />
      </TouchableOpacity>
      <Text style={s.label}>Today {label}</Text>
      <TouchableOpacity style={s.btn} onPress={onNext}>
        <ChevronRight size={14} color={INK} strokeWidth={2} />
      </TouchableOpacity>
      <View style={{ flex: 1 }} />
      <TouchableOpacity style={s.btn} onPress={onCalendar}>
        <Calendar size={13} color={INK} strokeWidth={1.5} />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8, gap: 4 },
  btn:   { padding: 6 },
  label: { fontFamily: Fonts.ui, fontSize: FontSizes.labelSm, color: INK, lineHeight: 10 },
});
