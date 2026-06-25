import React, { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet } from 'react-native';

export type DotMood = 'happy' | 'thinking' | 'excited' | 'sleeping';

const HAPPY_IMG    = require('../assets/dot-sprite/dot-happy.png');
const SLEEPING_IMG = require('../assets/dot-sprite/dot-sleeping.png');

interface Props { mood?: DotMood; size?: number; animated?: boolean }

const DEFAULT_SIZE = 42;

export default function DotCharacter({ mood = 'happy', size = DEFAULT_SIZE, animated = true }: Props) {
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animated) return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: -5, duration: 900, useNativeDriver: true }),
        Animated.timing(bob, { toValue:  0, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, [animated]);

  const src = mood === 'sleeping' ? SLEEPING_IMG : HAPPY_IMG;

  return (
    <Animated.View style={[{ width: size, height: size, marginLeft: 16 }, animated && { transform: [{ translateY: bob }] }]}>
      <Image source={src} style={{ width: size, height: size }} resizeMode="contain" />
    </Animated.View>
  );
}
