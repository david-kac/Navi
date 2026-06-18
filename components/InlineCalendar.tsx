import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';

const INK    = '#2D2D2D';
const BG     = '#FEFEFE';
const MUTED  = '#8A8480';
const BORDER = 1.354;
const DASH   = 0.677;
const RADIUS = 4;
const MARGIN = 18;

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_HDRS    = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function monthGrid(year: number, month: number): (number | null)[][] {
  const firstDow   = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMon  = new Date(year, month + 1, 0).getDate();
  const startOff   = firstDow === 0 ? 6 : firstDow - 1; // Mon-first
  const cells: (number | null)[] = [
    ...Array(startOff).fill(null),
    ...Array.from({ length: daysInMon }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

interface Props {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
}

export default function InlineCalendar({ selectedDate, onSelectDate }: Props) {
  const today = new Date();
  const [vy, setVy] = useState(selectedDate.getFullYear());
  const [vm, setVm] = useState(selectedDate.getMonth());

  const prevMonth = () => vm === 0 ? (setVy(y => y-1), setVm(11)) : setVm(m => m-1);
  const nextMonth = () => vm === 11 ? (setVy(y => y+1), setVm(0)) : setVm(m => m+1);
  const goToday   = () => { setVy(today.getFullYear()); setVm(today.getMonth()); onSelectDate(today); };

  const grid = monthGrid(vy, vm);

  return (
    <View style={s.root}>
      {/* Month nav */}
      <View style={s.monthRow}>
        <TouchableOpacity onPress={prevMonth} style={s.arrow}><ChevronLeft  size={12} color={INK} strokeWidth={2} /></TouchableOpacity>
        <Text style={s.monthLabel}>{MONTH_NAMES[vm]} {vy}</Text>
        <TouchableOpacity onPress={nextMonth} style={s.arrow}><ChevronRight size={12} color={INK} strokeWidth={2} /></TouchableOpacity>
      </View>

      {/* Day headers */}
      <View style={s.dayRow}>
        {DAY_HDRS.map(d => <Text key={d} style={s.dayHdr}>{d}</Text>)}
      </View>

      {/* Date grid */}
      {grid.map((row, ri) => (
        <View key={ri} style={s.dateRow}>
          {row.map((day, di) => {
            if (!day) return <View key={di} style={s.cell} />;
            const isToday    = day === today.getDate()            && vm === today.getMonth()            && vy === today.getFullYear();
            const isSelected = day === selectedDate.getDate() && vm === selectedDate.getMonth() && vy === selectedDate.getFullYear();
            return (
              <TouchableOpacity
                key={di}
                style={s.cell}
                onPress={() => onSelectDate(new Date(vy, vm, day))}
                activeOpacity={0.7}
              >
                <View style={[s.dateBubble, isSelected && s.dateBubbleSel, isToday && s.dateBubbleToday]}>
                  <Text style={[s.dateNum, isSelected && s.dateSelTxt, isToday && s.dateTodayTxt]}>{day}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      {/* Go to today */}
      <TouchableOpacity style={s.todayBtn} onPress={goToday} activeOpacity={0.8}>
        <Text style={s.todayBtnTxt}>GO TO TODAY</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    marginHorizontal: MARGIN, marginBottom: 14,
    borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS,
    backgroundColor: BG, overflow: 'hidden',
  },
  monthRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: DASH, borderBottomColor: INK,
  },
  arrow:      { padding: 6 },
  monthLabel: { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11 },
  dayRow:     { flexDirection: 'row', paddingHorizontal: 4, paddingTop: 8, paddingBottom: 4, borderBottomWidth: DASH, borderBottomColor: INK },
  dayHdr:     { flex: 1, textAlign: 'center', fontFamily: 'PressStart2P', fontSize: 5, color: MUTED, lineHeight: 8 },
  dateRow:       { flexDirection: 'row', paddingHorizontal: 6, paddingVertical: 2 },
  cell:          { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 3 },
  dateBubble:      { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  dateBubbleSel:   { backgroundColor: '#D0CECC', borderRadius: 13 },
  dateBubbleToday: { backgroundColor: INK, borderRadius: 13 },
  dateNum:         { fontFamily: 'VT323', fontSize: 16, color: INK, lineHeight: 20 },
  dateSelTxt:      { color: INK },
  dateTodayTxt:    { color: BG },
  todayBtn:   {
    margin: 8, borderRadius: RADIUS, backgroundColor: INK,
    paddingVertical: 10, alignItems: 'center',
  },
  todayBtnTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: BG, lineHeight: 11 },
});
