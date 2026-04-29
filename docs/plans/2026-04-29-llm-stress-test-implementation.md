# LLM Stress Test Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agent/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Build a Next.js web application to stress-test local LLMs via their OpenAI-compatible APIs, providing real-time TPS and latency metrics.

**Architecture:** Next.js App Router for frontend and backend. Backend uses `fetch` to send concurrent requests and SSE to stream metrics back.

**Tech Stack:** Next.js, React, TailwindCSS, shadcn/ui, Vitest (for testing).

---

### Task 1: Project Scaffold & UI Lib Setup

**Files:**
- Create: `package.json`, `next.config.mjs`, `components.json`, `vitest.config.ts`

**Step 1: Scaffold Next.js Application**
Run: `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes`
Expected: Next.js project created in the current directory.

**Step 2: Initialize shadcn/ui**
Run: `npx shadcn-ui@latest init --yes --defaults`
Expected: `components.json` created and base styles configured.

**Step 3: Add UI Components**
Run: `npx shadcn-ui@latest add button input select slider table card label textarea --yes`
Expected: UI components added to `src/components/ui/`.

**Step 4: Set up Vitest**
Run: `npm install -D vitest @vitest/ui @testing-library/react @testing-library/dom jsdom`
Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
```

**Step 5: Commit**
```bash
git add .
git commit -m "chore: scaffold next.js app with shadcn and vitest"
```

### Task 2: Backend - Models API Route

**Files:**
- Create: `src/app/api/models/route.ts`
- Create: `src/app/api/models/route.test.ts`

**Step 1: Write the failing test**
Create `src/app/api/models/route.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { GET } from './route';

describe('GET /api/models', () => {
  it('fetches models from the provided baseUrl', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3' }] })
    });

    const request = new Request('http://localhost:3000/api/models?baseUrl=http://local:11434/v1&apiKey=test');
    const response = await GET(request);
    const json = await response.json();

    expect(json.data[0].id).toBe('llama3');
    expect(global.fetch).toHaveBeenCalledWith('http://local:11434/v1/models', {
      headers: { 'Authorization': 'Bearer test' }
    });
  });
});
```

**Step 2: Run test to verify it fails**
Run: `npx vitest run src/app/api/models/route.test.ts`
Expected: FAIL with module not found or function not defined.

**Step 3: Write minimal implementation**
Create `src/app/api/models/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const baseUrl = url.searchParams.get('baseUrl');
  const apiKey = url.searchParams.get('apiKey') || '';

  if (!baseUrl) {
    return NextResponse.json({ error: 'baseUrl is required' }, { status: 400 });
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) throw new Error('Failed to fetch models');

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

**Step 4: Run test to verify it passes**
Run: `npx vitest run src/app/api/models/route.test.ts`
Expected: PASS

**Step 5: Commit**
```bash
git add src/app/api/models
git commit -m "feat: add models api route"
```

### Task 3: Backend - Stress Test Route (SSE)

**Files:**
- Create: `src/app/api/stress-test/route.ts`

**Step 1: Install concurrency library**
Run: `npm install p-limit`
Expected: `p-limit` added to dependencies.

**Step 2: Write implementation**
*(Note: SSE endpoints are complex to mock purely in unit tests without extensive setup, we will implement directly and test via E2E/manual)*
Create `src/app/api/stress-test/route.ts` (skeleton, details will be fleshed out during execution):
```typescript
import { NextRequest } from 'next/server';
import pLimit from 'p-limit';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { baseUrl, apiKey, model, prompt, concurrency, totalRequests, maxTokens } = body;

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
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: prompt }],
              max_tokens: parseInt(maxTokens),
              stream: true
            })
          });

          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          
          if (!res.body) throw new Error('No body');
          const reader = res.body.getReader();
          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            if (!firstTokenTime) firstTokenTime = Date.now();
            tokens++; // simplified token count based on chunks
          }

          const end = Date.now();
          const ttft = firstTokenTime - start;
          const latency = end - start;
          const tps = tokens / ((latency - ttft) / 1000) || 0;

          completed++;
          sendEvent('metrics', { id: i, status: 'success', ttft, latency, tps });
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
}
```

**Step 3: Commit**
```bash
git add package.json package-lock.json src/app/api/stress-test
git commit -m "feat: add streaming stress test runner"
```

### Task 4: Frontend Dashboard Integration

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/components/Dashboard.tsx`

**Step 1: Install Recharts**
Run: `npm install recharts`

**Step 2: Implement Dashboard UI**
Create `src/components/Dashboard.tsx` and integrate the forms, model fetching, and SSE connection logic. 

**Step 3: Update Main Page**
Modify `src/app/page.tsx` to render the Dashboard.

**Step 4: Commit**
```bash
git add package.json package-lock.json src/components src/app/page.tsx
git commit -m "feat: add frontend dashboard and connect to backend"
```
