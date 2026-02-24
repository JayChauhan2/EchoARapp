import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system';

const cacheDir = (FileSystem as any).cacheDirectory || (FileSystem as any).documentDirectory;
const writeAsync = (FileSystem as any).writeAsStringAsync;
const EncType = (FileSystem as any).EncodingType;

const BASE_URL = 'ws://127.0.0.1:3000/stream';
const SAMPLE_RATE = 24000;

/**
 * Creates a WAV header for PCM16 data.
 */
function createWavHeader(dataLength: number, sampleRate: number): Buffer {
    const header = Buffer.alloc(44);

    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataLength, 4);
    header.write('WAVE', 8);

    // FMT sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // Subchunk1Size
    header.writeUInt16LE(1, 20);  // AudioFormat (PCM)
    header.writeUInt16LE(1, 22);  // NumChannels (Mono)
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28); // ByteRate (sampleRate * NumChannels * BitsPerSample/8)
    header.writeUInt16LE(2, 32);  // BlockAlign (NumChannels * BitsPerSample/8)
    header.writeUInt16LE(16, 34); // BitsPerSample

    // Data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return header;
}

/**
 * Generates a random 32-character hexadecimal string for tracking.
 */
function getRandomHex(length: number): string {
    return [...Array(length)].map(() => Math.floor(Math.random() * 16).toString(16)).join('').toLowerCase();
}

/**
 * Synthesizes speech using VibeVoice WebSocket server.
 */
export const synthesizeSpeech = async (
    text: string,
    voice: string = 'en-Carter_man',
    cfg: number = 1.5,
    steps: number = 5
): Promise<string> => {
    const requestId = getRandomHex(16);
    // VibeVoice expects parameters in query string for /stream
    const url = `${BASE_URL}?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}&cfg=${cfg}&steps=${steps}`;

    console.log('--- VibeVoice TTS Debug ---');
    console.log('URL:', url);

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let audioDataChunks: Buffer[] = [];
        let totalLength = 0;

        ws.onopen = () => {
            console.log('VibeVoice WebSocket opened');
        };

        ws.onmessage = async (event) => {
            if (typeof event.data === 'string') {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'log') {
                        // console.log(`[VibeVoice Log] ${message.event}:`, message.data);
                        if (message.event === 'backend_stream_complete') {
                            // Handled by onclose or could be here
                        }
                    }
                } catch (e) {
                    // Not JSON, might be status text or something else
                }
            } else {
                // Binary data (PCM16 chunks)
                const chunk = Buffer.from(event.data);
                audioDataChunks.push(chunk);
                totalLength += chunk.length;
            }
        };

        ws.onerror = (error) => {
            console.error('VibeVoice TTS Error:', error);
            reject(error);
        };

        ws.onclose = async () => {
            console.log('VibeVoice WebSocket closed');
            if (audioDataChunks.length === 0) {
                reject(new Error('No audio data received from VibeVoice'));
                return;
            }

            try {
                const pcmBuffer = Buffer.concat(audioDataChunks);
                const wavHeader = createWavHeader(totalLength, SAMPLE_RATE);
                const fullAudio = Buffer.concat([wavHeader, pcmBuffer]);

                const fileName = `${cacheDir}vibevoice_${requestId}.wav`;
                await writeAsync(fileName, fullAudio.toString('base64'), {
                    encoding: EncType.Base64,
                });

                resolve(fileName);
            } catch (err) {
                console.error('Error post-processing VibeVoice audio:', err);
                reject(err);
            }
        };
    });
};
