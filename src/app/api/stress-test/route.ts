import { NextRequest } from 'next/server';
import pLimit from 'p-limit';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { baseUrl, apiKey, model, prompt, concurrency, totalRequests, maxTokens } = body;

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

          try {
            const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey || ''}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
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

            while (true) {
              const { done } = await reader.read();
              if (done) break;
              
              if (!firstTokenTime) {
                firstTokenTime = Date.now();
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
            sendEvent('metrics', { id: i, status: 'success', ttft, latency, tps, tokens });
          } catch (error: any) {
            completed++;
            sendEvent('metrics', { id: i, status: 'error', error: error.message });
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
