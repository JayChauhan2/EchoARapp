import axios from 'axios';

const GROQ_API_URL = 'https://api.groq.com/openai/v1';

export interface GroqConfig {
  apiKey: string;
  model?: string;
}

export const transcribeAudio = async (uri: string, apiKey: string) => {
  const formData = new FormData();
  // @ts-ignore
  formData.append('file', {
    uri,
    name: 'recording.m4a',
    type: 'audio/m4a',
  });
  formData.append('model', 'whisper-large-v3');

  const response = await axios.post(`${GROQ_API_URL}/audio/transcriptions`, formData, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data.text;
};

export const getGroqResponse = async (text: string, apiKey: string) => {
  const response = await axios.post(
    `${GROQ_API_URL}/chat/completions`,
    {
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful AI assistant. Keep your responses concise and suitable for text-to-speech.',
        },
        {
          role: 'user',
          content: text,
        },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.choices[0].message.content;
};
