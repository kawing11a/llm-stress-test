'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
  const [baseUrl, setBaseUrl] = useState('http://192.168.0.184:11434/v1');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<any[]>([]);
  const [model, setModel] = useState('');

  const [prompt, setPrompt] = useState('What is the meaning of life?');
  const [maxTokens, setMaxTokens] = useState('100');
  const [concurrency, setConcurrency] = useState('5');
  const [totalRequests, setTotalRequests] = useState('50');
  const [contextPadding, setContextPadding] = useState('0');

  const [isRunning, setIsRunning] = useState(false);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [stats, setStats] = useState({ success: 0, error: 0, avgTps: 0, p50: 0, p90: 0, p99: 0, avgTtft: 0 });
  const [logs, setLogs] = useState<any[]>([]);

  const fetchModels = async () => {
    try {
      const res = await fetch(`/api/models?baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(apiKey)}`);
      const data = await res.json();
      if (data.data) {
        setModels(data.data);
        if (data.data.length > 0 && !model) setModel(data.data[0].id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const startTest = async () => {
    setIsRunning(true);
    setMetrics([]);
    setStats({ success: 0, error: 0, avgTps: 0, p50: 0, p90: 0, p99: 0, avgTtft: 0 });
    setLogs([]);

    try {
      const res = await fetch('/api/stress-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey, model, prompt, concurrency, totalRequests, maxTokens, contextPadding })
      });

      if (!res.body) throw new Error('No readable stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let currentMetrics: any[] = [];
      let successCount = 0;
      let errorCount = 0;
      let tpsSum = 0;
      let ttftSum = 0;
      let latencies: number[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '').trim();
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);
              if (data.message === 'Test completed') {
                setIsRunning(false);
                break;
              }

              if (data.type === 'start') {
                setLogs(prev => {
                  if (prev.some(l => l.id === data.id)) return prev;
                  return [...prev, {
                    id: data.id,
                    prompt: data.prompt,
                    response: '',
                    latency: '...',
                    ttft: '...'
                  }];
                });
              } else if (data.type === 'stream') {
                setLogs(prev => prev.map(l => l.id === data.id ? { ...l, response: l.response + data.chunk } : l));
              } else if (data.status === 'success') {
                successCount++;
                tpsSum += data.tps;
                latencies.push(data.latency);
                ttftSum += data.ttft;

                // Update charts
                currentMetrics = [...currentMetrics, {
                  id: currentMetrics.length,
                  tps: Math.round(data.tps * 10) / 10,
                  latency: data.latency,
                  ttft: data.ttft
                }];
                setMetrics(currentMetrics);
                
                setLogs(prev => prev.map(l => l.id === data.id ? {
                  ...l,
                  response: data.response || l.response || '(No response text)',
                  latency: data.latency,
                  ttft: data.ttft
                } : l));
              } else if (data.status === 'error') {
                errorCount++;
                setLogs(prev => prev.map(l => l.id === data.id ? {
                  ...l,
                  response: `Error: ${data.error}`,
                  latency: 'N/A',
                  ttft: 'N/A'
                } : l));
              }

              if (data.status === 'success' || data.status === 'error') {
                // Update stats
                latencies.sort((a, b) => a - b);
                setStats({
                  success: successCount,
                  error: errorCount,
                  avgTps: successCount > 0 ? tpsSum / successCount : 0,
                  avgTtft: successCount > 0 ? ttftSum / successCount : 0,
                  p50: latencies[Math.floor(latencies.length * 0.5)] || 0,
                  p90: latencies[Math.floor(latencies.length * 0.9)] || 0,
                  p99: latencies[Math.floor(latencies.length * 0.99)] || 0,
                });
              }

            } catch (e) {
              console.error("Failed to parse SSE JSON", e, dataStr);
            }
          }
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="container mx-auto p-4 flex flex-col md:flex-row gap-6">
      {/* Sidebar Configuration */}
      <div className="w-full md:w-1/3 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Base URL</Label>
              <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>API Key (Optional)</Label>
              <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} />
            </div>
            <Button onClick={fetchModels} className="w-full" variant="secondary">Fetch Models</Button>
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={model} onValueChange={(val) => setModel(val || '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Test Parameters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Prompt</Label>
              <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Max Tokens</Label>
                <Input type="number" value={maxTokens} onChange={e => setMaxTokens(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Concurrency</Label>
                <Input type="number" value={concurrency} onChange={e => setConcurrency(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Total Requests</Label>
                <Input type="number" value={totalRequests} onChange={e => setTotalRequests(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Context Padding (Tokens)</Label>
                <Input type="number" value={contextPadding} onChange={e => setContextPadding(e.target.value)} />
              </div>
            </div>
            <Button
              onClick={startTest}
              disabled={isRunning || !model}
              className="w-full mt-4"
            >
              {isRunning ? 'Running Test...' : 'Start Stress Test'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Area */}
      <div className="w-full md:w-2/3 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card><CardContent className="p-4 text-center"><div className="text-sm text-gray-500">Success</div><div className="text-2xl font-bold text-green-500">{stats.success}</div></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><div className="text-sm text-gray-500">Errors</div><div className="text-2xl font-bold text-red-500">{stats.error}</div></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><div className="text-sm text-gray-500">Avg TTFT</div><div className="text-2xl font-bold">{stats.avgTtft.toFixed(0)}ms</div></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><div className="text-sm text-gray-500">Avg TPS</div><div className="text-2xl font-bold">{stats.avgTps.toFixed(1)}</div></CardContent></Card>
          <Card><CardContent className="p-4 text-center"><div className="text-sm text-gray-500">P90 Latency</div><div className="text-2xl font-bold">{stats.p90.toFixed(0)}ms</div></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>TPS Over Time</CardTitle>
            <CardDescription>Tokens Per Second per request</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="id" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="tps" stroke="#8884d8" name="TPS" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latency (ms)</CardTitle>
            <CardDescription>Total Round Trip Time & TTFT</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={metrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="id" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="latency" stroke="#82ca9d" name="Total Latency (ms)" dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="ttft" stroke="#ffc658" name="TTFT (ms)" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Request Logs</CardTitle>
            <CardDescription>Ask and Response for each request</CardDescription>
          </CardHeader>
          <CardContent className="h-[400px] overflow-y-auto space-y-4">
            {logs.map((log, idx) => (
              <div key={idx} className="border p-4 rounded-md text-sm space-y-2 bg-muted/20">
                <div className="font-semibold border-b pb-2">Request #{log.id} <span className="text-muted-foreground font-normal ml-2">(Latency: {log.latency}{log.latency !== '...' && log.latency !== 'N/A' ? 'ms' : ''} | TTFT: {log.ttft}{log.ttft !== '...' && log.ttft !== 'N/A' ? 'ms' : ''})</span></div>
                <div><span className="font-semibold text-blue-500 mr-2">Ask:</span>{log.prompt}</div>
                <div className="whitespace-pre-wrap"><span className="font-semibold text-green-500 mr-2">Response:</span>{log.response}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
