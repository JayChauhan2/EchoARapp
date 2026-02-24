import { Buffer } from 'buffer';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';

const cacheDir = (FileSystem as any).cacheDirectory || FileSystem.documentDirectory;
const writeAsync = (FileSystem as any).writeAsStringAsync;
const EncType = (FileSystem as any).EncodingType;

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const BASE_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

/**
 * Generates the Sec-MS-GEC token required by Microsoft's Edge TTS server.
 * This mimics the logic in the Python edge-tts library.
 */
async function getSecMsGec(): Promise<string> {
    // Unix epoch to Windows epoch offset: 11644473600 seconds
    // Windows ticks are 100-nanosecond intervals
    const unixTimestamp = Math.floor(Date.now() / 1000);
    const windowsTicks = (BigInt(unixTimestamp) + BigInt(11644473600)) * BigInt(10000000);

    // Round down to the nearest 5 minutes (300,000,000,000 nanoseconds / 100 = 3,000,000,000 ticks)
    const roundedTicks = windowsTicks - (windowsTicks % BigInt(3000000000));

    const strToHash = roundedTicks.toString() + TRUSTED_CLIENT_TOKEN;
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, strToHash);
    return hash.toUpperCase();
}

/**
 * Generates a random 32-character hexadecimal string.
 */
function getRandomHex(length: number): string {
    return [...Array(length)].map(() => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase();
}

export const synthesizeSpeech = async (text: string, voice: string = 'en-US-AndrewNeural'): Promise<string> => {
    const connectionId = getRandomHex(32).toLowerCase();
    const secMsGec = await getSecMsGec();
    const muid = getRandomHex(32);

    const url = `${BASE_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=1-130.0.2849.68`;

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'X-MUID': muid,
        'Cookie': `muid=${muid};`,
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Accept-Language': 'en-US,en;q=0.9',
    };

    console.log('--- Edge TTS Debug ---');
    console.log('URL:', url);
    console.log('Headers:', JSON.stringify(headers, null, 2));

    return new Promise((resolve, reject) => {
        // In React Native/Expo, the WebSocket constructor supports a 3rd argument for headers
        // @ts-ignore
        const ws = new WebSocket(url, null, { headers });
        let audioData = Buffer.alloc(0);
        const requestId = getRandomHex(32).toLowerCase();

        ws.onopen = () => {
            // 1. Send configuration
            const config = {
                context: {
                    synthesis: {
                        audio: {
                            metadataoptions: {
                                sentenceBoundaryEnabled: "false",
                                wordBoundaryEnabled: "false",
                            },
                            outputFormat: "audio-24khz-48kbitrate-mono-mp3",
                        },
                    },
                },
            };

            const configHeader = `X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`;
            ws.send(configHeader + JSON.stringify(config));

            // 2. Send SSML
            const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${text}</prosody></voice></speak>`;
            const ssmlHeader = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}\r\nPath:ssml\r\n\r\n`;
            ws.send(ssmlHeader + ssml);
        };

        ws.onmessage = async (event) => {
            if (typeof event.data === 'string') {
                if (event.data.includes('Path:turn.end')) {
                    const fileName = `${cacheDir}response_${requestId}.mp3`;
                    await writeAsync(fileName, audioData.toString('base64'), {
                        encoding: EncType.Base64,
                    });
                    ws.close();
                    resolve(fileName);
                }
            } else {
                // Binary data
                // Binary messages have a 2-byte header indicating the length of the string header
                const data = new Uint8Array(event.data);
                const headerLength = (data[0] << 8) | data[1];
                const audioPart = data.slice(2 + headerLength);
                audioData = Buffer.concat([audioData, Buffer.from(audioPart)]);
            }
        };

        ws.onerror = (error) => {
            console.error('Edge TTS Error:', error);
            reject(error);
        };

        ws.onclose = () => {
            // console.log('WebSocket closed');
        };
    });
};

