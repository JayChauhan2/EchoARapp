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

export const streamGroqResponse = async (
  text: string,
  apiKey: string,
  onToken: (token: string) => void
) => {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${GROQ_API_URL}/chat/completions`);
    xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    const body = JSON.stringify({
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
      stream: true,
    });

    let lastIndex = 0;

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 3 || xhr.readyState === 4) {
        const newData = xhr.responseText.substring(lastIndex);
        lastIndex = xhr.responseText.length;

        const lines = newData.split('\n');
        for (const line of lines) {
          const message = line.replace(/^data: /, '').trim();
          if (message === '' || message === '[DONE]') continue;

          try {
            const parsed = JSON.parse(message);
            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              onToken(content);
            }
          } catch (e) {
            // Incomplete JSON is expected in readyState 3
          }
        }
      }

      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Groq API error: ${xhr.status} ${xhr.statusText}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error during Groq streaming'));
    xhr.send(body);
  });
};
