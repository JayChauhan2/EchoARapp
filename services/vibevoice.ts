import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system/legacy';

const cacheDir = (FileSystem as any).cacheDirectory || (FileSystem as any).documentDirectory;
const writeAsync = (FileSystem as any).writeAsStringAsync;


const BASE_URL = 'ws://192.168.0.153:3000/stream';
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
 * Normalizes PCM16 audio to a target peak.
 */
function normalizePCM16(buffer: Buffer, targetPeak: number = 0.9): Buffer {
    let maxAbs = 0;
    for (let i = 0; i < buffer.length; i += 2) {
        if (i + 1 >= buffer.length) break;
        const sample = buffer.readInt16LE(i);
        const absSample = Math.abs(sample);
        if (absSample > maxAbs) maxAbs = absSample;
    }

    if (maxAbs === 0) return buffer;

    const currentPeak = maxAbs / 32767;
    if (currentPeak >= targetPeak) return buffer; // Already loud enough

    const gain = targetPeak / currentPeak;
    console.log(`[VibeVoice] Normalizing: maxAbs=${maxAbs}, Current Peak=${currentPeak.toFixed(4)}, Gain=${gain.toFixed(2)}x, Target=${targetPeak}`);

    for (let i = 0; i < buffer.length; i += 2) {
        if (i + 1 >= buffer.length) break;
        const sample = buffer.readInt16LE(i);
        let boosted = Math.round(sample * gain);
        // Clamp to 16-bit range
        boosted = Math.max(-32768, Math.min(32767, boosted));
        buffer.writeInt16LE(boosted, i);
    }

    return buffer;
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
                let pcmBuffer = Buffer.concat(audioDataChunks);

                // Boost volume
                pcmBuffer = normalizePCM16(pcmBuffer, 0.95);

                const wavHeader = createWavHeader(pcmBuffer.length, SAMPLE_RATE);
                const fullAudio = Buffer.concat([wavHeader as any, pcmBuffer as any]);

                const fileName = `${cacheDir}vibevoice_${requestId}.wav`;
                await writeAsync(fileName, fullAudio.toString('base64'), {
                    encoding: 'base64',
                });

                resolve(fileName);
            } catch (err) {
                console.error('Error post-processing VibeVoice audio:', err);
                reject(err);
            }
        };
    });
};
