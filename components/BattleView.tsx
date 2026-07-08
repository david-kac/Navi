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

const STORAGE_KEY = 'battle:streak';
const TOTAL = 100;
const COLS = 10;
const CELL = 22;
const GAP = 8;

export default function BattleView() {
  const [streak, setStreak] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(v => {
      setStreak(v ? parseInt(v, 10) : 0);
      setLoaded(true);
    });
  }, []);

  const persist = useCallback(async (next: number) => {
    setStreak(next);
    await AsyncStorage.setItem(STORAGE_KEY, String(next));
  }, []);

  const onVictory = () => {
    if (streak >= TOTAL) return;
    persist(Math.min(TOTAL, streak + 1));
  };

  const onRestart = () => {
    Alert.alert('Reset your streak back to 0?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: () => persist(0) },
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
            <View key={i} style={[s.cell, { backgroundColor: i < streak ? FILLED : UNFILLED }]} />
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

  grid: { width: GRID_WIDTH, flexDirection: 'row', flexWrap: 'wrap', gap: GAP, marginBottom: 24 },
  cell: { width: CELL, height: CELL, borderRadius: 2 },

  actions:    { width: '100%', maxWidth: 309, alignItems: 'center', gap: 16 },
  victoryBtn: { width: '100%', borderWidth: 1.5, borderColor: INK, borderRadius: RADIUS, backgroundColor: BG, paddingVertical: 12, alignItems: 'center' },
  victoryTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: INK, lineHeight: 11 },
  restartTxt: { fontFamily: 'PressStart2P', fontSize: 7, color: RESTART_GRAY, lineHeight: 11 },
});
