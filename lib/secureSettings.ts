import * as SecureStore from 'expo-secure-store';

const ANTHROPIC_API_KEY = 'ANTHROPIC_API_KEY';

export async function getAnthropicApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(ANTHROPIC_API_KEY);
}

export async function setAnthropicApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(ANTHROPIC_API_KEY, key);
}

export async function clearAnthropicApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(ANTHROPIC_API_KEY);
}
