import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { getAnthropicApiKey, setAnthropicApiKey, clearAnthropicApiKey } from '../lib/secureSettings';
import { callDot } from '../lib/ai';

const INK = '#2D2D2D';
const BG = '#FEFEFE';
const MUTED = '#8A8480';
const BORDER = 1.354;
const RADIUS = 4;

export default function Settings() {
  const router = useRouter();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    getAnthropicApiKey().then(key => setHasKey(!!key));
  }, []);

  const onSave = async () => {
    if (!input.trim()) return;
    setSaving(true);
    try {
      await setAnthropicApiKey(input.trim());
      setInput('');
      setHasKey(true);
      setStatus('Saved.');
    } finally {
      setSaving(false);
    }
  };

  const onClear = async () => {
    await clearAnthropicApiKey();
    setHasKey(false);
    setStatus('Cleared.');
  };

  const onTest = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const reply = await callDot(
        'Reply with exactly: "Dot is online."',
        [{ role: 'user', content: 'ping' }],
        20
      );
      setStatus(`Claude says: ${reply}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Test failed.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <ChevronLeft size={16} color={INK} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>SETTINGS</Text>
      </View>

      <View style={s.content}>
        <Text style={s.label}>ANTHROPIC API KEY</Text>

        {hasKey === null ? (
          <ActivityIndicator color={INK} />
        ) : hasKey ? (
          <>
            <Text style={s.statusText}>A key is currently saved. It is never shown again once entered.</Text>
            <TouchableOpacity style={s.clearBtn} onPress={onTest} disabled={testing} activeOpacity={0.8}>
              {testing ? <ActivityIndicator color={INK} /> : <Text style={s.clearBtnText}>TEST CONNECTION</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.clearBtn} onPress={onClear} activeOpacity={0.8}>
              <Text style={s.clearBtnText}>CLEAR SAVED KEY</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={s.statusText}>No key saved yet. Dot can't think without one.</Text>
        )}

        <TextInput
          style={s.input}
          placeholder="sk-ant-..."
          placeholderTextColor={MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          value={input}
          onChangeText={setInput}
        />
        {status ? <Text style={s.status}>{status}</Text> : null}
        <TouchableOpacity
          style={[s.saveBtn, (!input.trim() || saving) && s.saveBtnDisabled]}
          onPress={onSave}
          disabled={!input.trim() || saving}
          activeOpacity={0.8}
        >
          {saving ? <ActivityIndicator color={BG} /> : <Text style={s.saveBtnText}>SAVE KEY</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:        { flex: 1, backgroundColor: BG },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12 },
  backBtn:     { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'PressStart2P', fontSize: 10, color: INK },
  content:     { paddingHorizontal: 18, paddingTop: 20, gap: 12 },
  label:       { fontFamily: 'PressStart2P', fontSize: 7, color: MUTED, letterSpacing: 1 },
  statusText:  { fontFamily: 'VT323', fontSize: 16, color: INK, marginBottom: 4 },
  status:      { fontFamily: 'VT323', fontSize: 14, color: MUTED },
  input:       { height: 44, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingHorizontal: 12, fontFamily: 'VT323', fontSize: 16, color: INK },
  saveBtn:     { backgroundColor: INK, borderRadius: RADIUS, paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: 'PressStart2P', fontSize: 9, color: BG },
  clearBtn:    { borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingVertical: 11, alignItems: 'center' },
  clearBtnText:{ fontFamily: 'PressStart2P', fontSize: 8, color: INK },
});
