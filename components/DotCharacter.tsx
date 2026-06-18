import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet } from 'react-native';

export type DotMood = 'happy' | 'thinking' | 'excited' | 'sleeping';

const HAPPY_IMG    = require('../assets/dot-sprite/dot-happy.png');
const SLEEPING_IMG = require('../assets/dot-sprite/dot-sleeping.png');

interface Props { mood?: DotMood }

export default function DotCharacter({ mood = 'happy' }: Props) {
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: -5, duration: 900, useNativeDriver: true }),
        Animated.timing(bob, { toValue:  0, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  const src = mood === 'sleeping' ? SLEEPING_IMG : HAPPY_IMG;

  return (
    <Animated.View style={[s.root, { transform: [{ translateY: bob }] }]}>
      <Image source={src} style={s.sprite} resizeMode="contain" />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  root:   { width: 42, height: 42, marginLeft: 16 },
  sprite: { width: 42, height: 42 },
});
