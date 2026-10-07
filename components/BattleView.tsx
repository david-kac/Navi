import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const INK       = '#2D2D2D';
const BG        = '#FEFEFE';
const MUTED     = '#8A8480';
const RADIUS    = 4;
const MARGIN    = 18;
const FILLED    = '#2A9D4A';
const UNFILLED  = '#D9D9D9';
const RESTART_GRAY = '#8E8E93';

// v1 stored only a count under 'battle:streak'. v2 stores one entry per
// completed box: its completion date (M/D label source) or null for boxes
// completed before dates were recorded — those stay unlabeled, never invented.
const LEGACY_KEY  = 'battle:streak';
const STORAGE_KEY = 'battle:streak:v2';
const TOTAL = 100;
const COLS = 10;
const CELL = 22;
const GAP = 8;
const LABEL_H = 14; // reserved under every cell so the grid never shifts as boxes complete

function todayLabelDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

// "2026-10-07" -> "10/7"
function monthDay(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
}

export default function BattleView() {
  const [days, setDays] = useState<(string | null)[]>([]);
  const [loaded, setLoaded] = useState(false);
  const streak = days.length;

  useEffect(() => {
    (async () => {
      try {
        const v2 = await AsyncStorage.getItem(STORAGE_KEY);
        if (v2) {
          const parsed = JSON.parse(v2);
          if (Array.isArray(parsed)) { setDays(parsed.slice(0, TOTAL)); return; }
        }
        // First run after the upgrade: carry the existing streak over as
        // undated boxes. The legacy key is left in place untouched.
        const legacy = await AsyncStorage.getItem(LEGACY_KEY);
        const count = legacy ? Math.max(0, Math.min(TOTAL, parseInt(legacy, 10) || 0)) : 0;
        const migrated: (string | null)[] = Array(count).fill(null);
        setDays(migrated);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const persist = useCallback(async (next: (string | null)[]) => {
    setDays(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const onVictory = () => {
    if (streak >= TOTAL) return;
    persist([...days, todayLabelDate()]);
  };

  const onRestart = () => {
    Alert.alert('Reset your streak back to 0?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => persist([]) },
    ]);
  };

  if (!loaded) return null;

  const isComplete = streak >= TOTAL;

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Text style={s.title}>Battle</Text>
      <Text style={s.counter}>{streak}/{TOTAL}</Text>

      {isComplete ? (
        <Text style={s.praise}>Praise God</Text>
      ) : (
        <View style={s.grid}>
          {Array.from({ length: TOTAL }).map((_, i) => (
            <View key={i} style={s.cellWrap}>
              <View style={[s.cell, { backgroundColor: i < streak ? FILLED : UNFILLED }]} />
              <Text style={s.cellLabel} numberOfLines={1}>{i < streak && days[i] ? monthDay(days[i]!) : ' '}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={s.actions}>
        <TouchableOpacity style={s.victoryBtn} onPress={onVictory} activeOpacity={0.8}>
          <Text style={s.victoryTxt}>Victory</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onRestart} activeOpacity={0.7}>
          <Text style={s.restartTxt}>Restart</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const GRID_WIDTH = COLS * CELL + (COLS - 1) * GAP;

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
  content: { alignItems: 'center', paddingTop: 20, paddingBottom: 40, paddingHorizontal: MARGIN },

  title:   { fontFamily: 'PressStart2P', fontSize: 16, color: INK, lineHeight: 26, marginBottom: 8 },
  counter: { fontFamily: 'PressStart2P', fontSize: 7, color: MUTED, lineHeight: 10, marginBottom: 16 },
  praise:  { fontFamily: 'PressStart2P', fontSize: 16, color: INK, lineHeight: 26, textAlign: 'center', marginTop: 60, marginBottom: 60 },

  // Row gap is just GAP; the label's own reserved height sits inside each wrapper.
  grid: { width: GRID_WIDTH, flexDirection: 'row', flexWrap: 'wrap', gap: GAP, marginBottom: 24 },
  cellWrap:  { width: CELL, alignItems: 'center' },
  cellLabel: { width: CELL + GAP, height: LABEL_H, fontFamily: 'VT323', fontSize: 12, lineHeight: LABEL_H, color: MUTED, textAlign: 'center' },
  cell: { width: CELL, height: CELL, borderRadius: 2 },

  actions:    { width: '100%', maxWidth: 309, alignItems: 'center', gap: 16 },
  victoryBtn: { width: '100%', borderWidth: 1.5, borderColor: INK, borderRadius: RADIUS, backgroundColor: BG, paddingVertical: 12, alignItems: 'center' },
  victoryTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11 },
  restartTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: RESTART_GRAY, lineHeight: 11 },
});
