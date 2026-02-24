import { Audio } from 'expo-av';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity } from 'react-native';

import { HelloWave } from '@/components/hello-wave';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

// Services
import { getGroqResponse, transcribeAudio } from '@/services/groq';
import { synthesizeSpeech } from '@/services/vibevoice';

export default function HomeScreen() {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [groqApiKey, setGroqApiKey] = useState('');
  const [status, setStatus] = useState('Ready');
  const [lastResponse, setLastResponse] = useState('');
  const [sound, setSound] = useState<Audio.Sound | null>(null);

  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound]);

  async function startRecording() {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setStatus('Listening...');
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  }

  async function stopRecording() {
    if (!recording) return;

    setRecording(null);
    setStatus('Processing...');
    setIsProcessing(true);

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();

      if (!uri || !groqApiKey) {
        setStatus('Error: Missing URI or API Key');
        setIsProcessing(false);
        return;
      }

      // 1. Transcribe (Groq Whisper)
      setStatus('Transcribing...');
      const transcript = await transcribeAudio(uri, groqApiKey);
      console.log('Transcript:', transcript);

      // 2. Get AI Response (Groq LLM)
      setStatus('Thinking...');
      const responseText = await getGroqResponse(transcript, groqApiKey);
      setLastResponse(responseText);

      // 3. Synthesize (VibeVoice)
      setStatus('Speaking...');
      const audioUri = await synthesizeSpeech(responseText);

      // 4. Playback
      setStatus('Playing...');
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: audioUri },
        { shouldPlay: true, volume: 1.0 }
      );
      setSound(newSound);

      setStatus('Done');
    } catch (err) {
      console.error('Processing error', err);
      setStatus('Error');
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Echo AI Assistant</ThemedText>
        <HelloWave />
      </ThemedView>

      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">Configuration</ThemedText>
        <TextInput
          style={styles.input}
          placeholder="Enter Groq API Key"
          placeholderTextColor="#888"
          value={groqApiKey}
          onChangeText={setGroqApiKey}
          secureTextEntry
        />
      </ThemedView>

      <ThemedView style={[styles.stepContainer, styles.voiceContainer]}>
        <ThemedText type="subtitle">Voice Mode</ThemedText>
        <ThemedText style={styles.statusText}>{status}</ThemedText>

        <TouchableOpacity
          style={[
            styles.voiceButton,
            recording ? styles.recordingButton : {},
            isProcessing ? styles.disabledButton : {}
          ]}
          onPress={recording ? stopRecording : startRecording}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.buttonText}>
              {recording ? 'Stop & Send' : 'Press to Talk'}
            </ThemedText>
          )}
        </TouchableOpacity>

        {lastResponse ? (
          <ThemedView style={styles.responseBox}>
            <ThemedText type="defaultSemiBold">AI Response:</ThemedText>
            <ThemedText>{lastResponse}</ThemedText>
          </ThemedView>
        ) : null}
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepContainer: {
    gap: 8,
    marginBottom: 8,
    padding: 16,
  },
  voiceContainer: {
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    marginTop: 10,
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    color: '#000',
    backgroundColor: '#fff',
  },
  voiceButton: {
    width: 200,
    height: 60,
    backgroundColor: '#007AFF',
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  recordingButton: {
    backgroundColor: '#FF3B30',
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statusText: {
    fontSize: 16,
    color: '#555',
  },
  responseBox: {
    marginTop: 20,
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 8,
    width: '100%',
  },
});

