import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring
} from 'react-native-reanimated';

import { HelloWave } from '@/components/hello-wave';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

// Services
import { streamGroqResponse, transcribeAudio } from '@/services/groq';
import { synthesizeSpeech } from '@/services/vibevoice';

const { width } = Dimensions.get('window');

export default function HomeScreen() {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const recordingRef = React.useRef<Audio.Recording | null>(null);
  const isRecordingIntent = React.useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [groqApiKey, setGroqApiKey] = useState('');
  const [status, setStatus] = useState('Ready');
  const [lastResponse, setLastResponse] = useState('');
  const [userTranscript, setUserTranscript] = useState('');
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isRecordingState, setIsRecordingState] = useState(false);

  // Queue and streaming state
  const audioQueue = React.useRef<string[]>([]);
  const isPlayingQueue = React.useRef(false);
  const isStreamingComplete = React.useRef(false);
  const pendingSynthesisCount = React.useRef(0);

  // Animation values
  const micScale = useSharedValue(1);

  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound]);

  async function processAudioQueue() {
    if (isPlayingQueue.current) return;
    isPlayingQueue.current = true;
    console.log('[Queue] Started');

    while (audioQueue.current.length > 0 || !isStreamingComplete.current || pendingSynthesisCount.current > 0) {
      if (audioQueue.current.length > 0) {
        const audioUri = audioQueue.current.shift();
        if (audioUri) {
          try {
            console.log('[Queue] Playing:', audioUri);
            const { sound: newSound } = await Audio.Sound.createAsync(
              { uri: audioUri },
              { shouldPlay: true, volume: 1.0 }
            );
            setSound(newSound);

            // Wait for it to finish playing
            await new Promise((resolve) => {
              newSound.setOnPlaybackStatusUpdate((status) => {
                if (status.isLoaded && status.didJustFinish) {
                  resolve(null);
                }
              });
            });

            await newSound.unloadAsync();
          } catch (err) {
            console.error('Error playing queued audio:', err);
          }
        }
      } else {
        // Buffer empty but stream not done, wait a bit
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    isPlayingQueue.current = false;
    setStatus('Done');
    console.log('[Queue] Finished');
  }

  async function startRecording() {
    isRecordingIntent.current = true;
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      if (!isRecordingIntent.current) {
        await newRecording.stopAndUnloadAsync();
        return;
      }

      recordingRef.current = newRecording;
      setRecording(newRecording);
      setIsRecordingState(true);
      setStatus('Listening...');
      micScale.value = withSpring(1.5);
      setUserTranscript('');
      setLastResponse('');
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  }

  async function stopRecording() {
    isRecordingIntent.current = false;
    const currentRec = recordingRef.current;
    if (!currentRec) return;

    recordingRef.current = null;
    setRecording(null);
    setIsRecordingState(false);
    setStatus('Processing...');
    setIsProcessing(true);
    micScale.value = withSpring(1);

    try {
      await currentRec.stopAndUnloadAsync();
      const uri = currentRec.getURI();

      if (!uri || !groqApiKey) {
        setStatus('Error: Missing URI or API Key');
        setIsProcessing(false);
        return;
      }

      // 1. Transcribe (Groq Whisper)
      setStatus('Transcribing...');
      const transcript = await transcribeAudio(uri, groqApiKey);
      console.log('Transcript:', transcript);

      // Animate user transcript appearing word by word
      const words = transcript.split(' ');
      let currentDisplay = '';
      for (let i = 0; i < words.length; i++) {
        currentDisplay += (i === 0 ? '' : ' ') + words[i];
        setUserTranscript(currentDisplay);
        await new Promise(r => setTimeout(r, 50));
      }

      // 2. Start Processing Pipeline
      setStatus('Thinking...');

      // Reset audio mode for playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      let fullText = '';
      await streamGroqResponse(transcript, groqApiKey, async (token) => {
        fullText += token;
        setLastResponse(fullText);
      });

      console.log('[Pipeline] Finished thinking. Synthesizing full text...');
      setStatus('Speaking...');

      if (fullText.trim().length > 0) {
        const audioUri = await synthesizeSpeech(fullText.trim());
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: audioUri },
          { shouldPlay: true, volume: 1.0 }
        );
        setSound(newSound);

        // Wait for it to finish playing
        await new Promise((resolve) => {
          newSound.setOnPlaybackStatusUpdate((status) => {
            if (status.isLoaded && status.didJustFinish) {
              resolve(null);
            }
          });
        });
        await newSound.unloadAsync();
      }

      setStatus('Done');

    } catch (err) {
      console.error('Processing error', err);
      setStatus('Error');
      setIsProcessing(false);
    } finally {
      setIsProcessing(false);
    }
  }

  const animatedMicStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: micScale.value }],
      backgroundColor: isRecordingState ? '#FF3B30' : '#007AFF',
    };
  });

  const renderFadingText = (text: string, color: string) => {
    const words = text.split(' ');
    return (
      <View style={styles.transcriptContainer}>
        {words.map((word, index) => {
          const opacity = Math.max(0.3, 1 - (words.length - 1 - index) * 0.1);
          return (
            <ThemedText
              key={index}
              style={[styles.animatedWord, { color, opacity }]}
            >
              {word}{' '}
            </ThemedText>
          );
        })}
      </View>
    );
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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

        <ThemedView style={styles.stepContainer}>
          <ThemedText type="subtitle">Instructions</ThemedText>
          <ThemedText>
            Hold the microphone button at the bottom to speak. Release it to send your message.
          </ThemedText>
        </ThemedView>

        {/* Space for the bottom bar and text */}
        <View style={{ height: 150 }} />
      </ParallaxScrollView>

      {/* Floating UI Elements */}
      <View style={styles.floatingContainer} pointerEvents="box-none">
        <View style={styles.textOverlay}>
          {userTranscript ? renderFadingText(userTranscript, '#333') : null}
          {lastResponse ? renderFadingText(lastResponse, '#007AFF') : null}
        </View>

        <View style={styles.micButtonContainer}>
          <ThemedText style={styles.statusText}>{status}</ThemedText>
          {isProcessing ? (
            <View style={styles.processingCircle}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <Pressable onPressIn={startRecording} onPressOut={stopRecording}>
              <Animated.View style={[styles.micButton, animatedMicStyle]}>
                <Ionicons name="mic" size={32} color="#fff" />
              </Animated.View>
            </Pressable>
          )}
        </View>
      </View>
    </GestureHandlerRootView>
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
  floatingContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingBottom: 40,
  },
  textOverlay: {
    width: width * 0.9,
    minHeight: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  transcriptContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  animatedWord: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '500',
  },
  micButtonContainer: {
    alignItems: 'center',
  },
  micButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  processingCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#ccc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    fontWeight: '600',
  },
});

