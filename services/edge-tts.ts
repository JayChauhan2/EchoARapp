import { Buffer } from 'buffer';
import * as FileSystem from 'expo-file-system';
const { cacheDirectory, writeAsStringAsync, EncodingType } = FileSystem;

const EDGE_TTS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

export const synthesizeSpeech = (text: string, voice: string = 'en-US-AndrewNeural'): Promise<string> => {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(EDGE_TTS_URL);
        let audioData = Buffer.alloc(0);
        const requestId = Math.random().toString(36).substring(7);

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
                    const fileName = `${cacheDirectory}response_${requestId}.mp3`;
                    await writeAsStringAsync(fileName, audioData.toString('base64'), {
                        encoding: EncodingType.Base64,
                    });
                    ws.close();
                    resolve(fileName);
                }
            } else {
                // Binary data
                // The first few bytes are the header, we need to skip them
                // In the Edge TTS protocol, binary messages have a 2-byte header indicating the length of the string header
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
