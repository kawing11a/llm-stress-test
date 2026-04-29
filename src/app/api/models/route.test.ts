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
      headers: { 'Authorization': 'Bearer test', 'Content-Type': 'application/json' }
    });
  });
});
