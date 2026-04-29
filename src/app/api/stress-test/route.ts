import { NextRequest } from 'next/server';
import pLimit from 'p-limit';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { baseUrl, apiKey, model, prompt, concurrency, totalRequests, maxTokens, contextPadding } = body;

    if (!baseUrl || !model || !prompt || !concurrency || !totalRequests) {
      return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const limit = pLimit(parseInt(concurrency));
        let completed = 0;

        const sendEvent = (event: string, data: any) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        const tasks = Array.from({ length: parseInt(totalRequests) }).map((_, i) => limit(async () => {
          const start = Date.now();
          let firstTokenTime = 0;
          let tokens = 0;
          
          let finalPrompt = prompt;
          const padTokens = parseInt(contextPadding) || 0;
          if (padTokens > 0) {
            const lorem = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
            const targetLength = padTokens * 4; // Approx 4 chars per token
            const paddingStr = lorem.repeat(Math.ceil(targetLength / lorem.length)).substring(0, targetLength);
            finalPrompt = `<padding>\n${paddingStr}\n</padding>\n\n${prompt}`;
          }
          
          sendEvent('metrics', { type: 'start', id: i, prompt: finalPrompt.length > 500 ? finalPrompt.substring(0, 100) + '... [Truncated]' : finalPrompt });

          try {
            const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey || ''}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: finalPrompt }],
                max_tokens: parseInt(maxTokens) || undefined,
                stream: true
              })
            });

            if (!res.ok) {
              const text = await res.text();
              throw new Error(`HTTP ${res.status}: ${text}`);
            }
            
            if (!res.body) throw new Error('No response body');
            
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let completionText = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              if (!firstTokenTime) {
                firstTokenTime = Date.now();
              }
              
              const chunkStr = decoder.decode(value, { stream: true });
              const lines = chunkStr.split('\n');
              for (const line of lines) {
                if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
                  try {
                    const parsed = JSON.parse(line.substring(6));
                    if (parsed.choices?.[0]?.delta?.content) {
                      const content = parsed.choices[0].delta.content;
                      completionText += content;
                      sendEvent('metrics', { type: 'stream', id: i, chunk: content });
                    }
                  } catch (e) {
                    // ignore partial json
                  }
                }
              }
              tokens++; // Treat each stream chunk as ~1 token for estimating TPS
            }

            const end = Date.now();
            const ttft = firstTokenTime ? firstTokenTime - start : end - start;
            const latency = end - start;
            // TPS calculation: total tokens / (generation duration in seconds)
            // If latency == ttft (e.g. 1 chunk), tps is mathematically undefined/infinite, so fallback to 0 or 1
            const generationTimeMs = latency - ttft;
            const tps = generationTimeMs > 0 ? (tokens / (generationTimeMs / 1000)) : 0;

            completed++;
            sendEvent('metrics', { type: 'success', status: 'success', id: i, ttft, latency, tps, tokens, response: completionText });
          } catch (error: any) {
            completed++;
            sendEvent('metrics', { type: 'error', status: 'error', id: i, error: error.message });
          }
        }));

        await Promise.all(tasks);
        sendEvent('done', { message: 'Test completed' });
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
