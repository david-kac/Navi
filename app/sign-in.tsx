import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../lib/AuthProvider';

const INK = '#2D2D2D';
const BG = '#FEFEFE';
const MUTED = '#8A8480';
const BORDER = 1.354;
const RADIUS = 4;

export default function SignIn() {
  const { sendMagicLink, verifyTokenHash } = useAuth();
  const [email, setEmail] = useState('kacinski.david@gmail.com');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tokenHash, setTokenHash] = useState('');
  const [verifying, setVerifying] = useState(false);

  const onSend = async () => {
    setError(null);
    setSending(true);
    try {
      await sendMagicLink(email.trim());
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSending(false);
    }
  };

  const onVerify = async () => {
    setError(null);
    setVerifying(true);
    try {
      await verifyTokenHash(tokenHash.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not work.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <SafeAreaView style={s.root}>
      <View style={s.content}>
        <Text style={s.title}>DOT</Text>
        <Text style={s.subtitle}>Sign in with a magic link</Text>

        {sent ? (
          <>
            <Text style={s.sentText}>Check {email} for your sign-in link.</Text>
            <Text style={s.helperText}>
              If tapping the link doesn't work, copy the value after "token=" in the link
              and paste it below.
            </Text>
            <TextInput
              style={s.input}
              placeholder="Paste token here"
              placeholderTextColor={MUTED}
              autoCapitalize="none"
              autoCorrect={false}
              value={tokenHash}
              onChangeText={setTokenHash}
            />
            {error ? <Text style={s.error}>{error}</Text> : null}
            <TouchableOpacity
              style={[s.button, (!tokenHash || verifying) && s.buttonDisabled]}
              onPress={onVerify}
              disabled={!tokenHash || verifying}
              activeOpacity={0.8}
            >
              {verifying ? <ActivityIndicator color={BG} /> : <Text style={s.buttonText}>VERIFY CODE</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput
              style={s.input}
              placeholder="you@example.com"
              placeholderTextColor={MUTED}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            {error ? <Text style={s.error}>{error}</Text> : null}
            <TouchableOpacity
              style={[s.button, (!email || sending) && s.buttonDisabled]}
              onPress={onSend}
              disabled={!email || sending}
              activeOpacity={0.8}
            >
              {sending ? <ActivityIndicator color={BG} /> : <Text style={s.buttonText}>SEND MAGIC LINK</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: 24, gap: 14 },
  title: { fontFamily: 'PressStart2P', fontSize: 24, color: INK, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontFamily: 'VT323', fontSize: 18, color: MUTED, textAlign: 'center', marginBottom: 16 },
  sentText: { fontFamily: 'VT323', fontSize: 18, color: INK, textAlign: 'center' },
  helperText: { fontFamily: 'VT323', fontSize: 14, color: MUTED, textAlign: 'center', marginBottom: 4 },
  input: { height: 44, borderWidth: BORDER, borderColor: INK, borderRadius: RADIUS, paddingHorizontal: 12, fontFamily: 'VT323', fontSize: 16, color: INK },
  error: { fontFamily: 'VT323', fontSize: 14, color: '#C0392B' },
  button: { backgroundColor: INK, borderRadius: RADIUS, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontFamily: 'PressStart2P', fontSize: 9, color: BG },
});
