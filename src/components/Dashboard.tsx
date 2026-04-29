'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  const [history, setHistory] = useState<any[]>([]);

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
                
                const finalAvgTps = successCount > 0 ? tpsSum / successCount : 0;
                const finalAvgTtft = successCount > 0 ? ttftSum / successCount : 0;
                latencies.sort((a, b) => a - b);
                const finalP90 = latencies[Math.floor(latencies.length * 0.9)] || 0;

                setHistory(prev => [{
                  id: prev.length + 1,
                  timestamp: new Date().toLocaleTimeString(),
                  model: model,
                  concurrency: concurrency,
                  contextPadding: contextPadding,
                  totalRequests: totalRequests,
                  success: successCount,
                  error: errorCount,
                  avgTtft: finalAvgTtft,
                  avgTps: finalAvgTps,
                  p90: finalP90
                }, ...prev]);

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
    <div className="h-full w-full flex flex-col p-4 gap-4 bg-muted/10">
      {/* Top Header / Stats */}
      <div className="flex shrink-0 gap-4">
        <div className="w-[300px] shrink-0 flex items-center justify-center bg-card rounded-xl border shadow-sm">
           <h1 className="text-xl font-bold tracking-tight">LLM Stress Test</h1>
        </div>
        <div className="flex-1 grid grid-cols-5 gap-4">
          <Card><CardContent className="p-3 text-center"><div className="text-xs text-muted-foreground uppercase tracking-wider">Success / Error</div><div className="text-xl font-bold"><span className="text-green-500">{stats.success}</span> / <span className="text-red-500">{stats.error}</span></div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-xs text-muted-foreground uppercase tracking-wider">Avg TTFT</div><div className="text-xl font-bold">{stats.avgTtft.toFixed(0)}ms</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-xs text-muted-foreground uppercase tracking-wider">Avg TPS</div><div className="text-xl font-bold">{stats.avgTps.toFixed(1)}</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-xs text-muted-foreground uppercase tracking-wider">P90 Latency</div><div className="text-xl font-bold">{stats.p90.toFixed(0)}ms</div></CardContent></Card>
          <Card><CardContent className="p-3 text-center"><div className="text-xs text-muted-foreground uppercase tracking-wider">Status</div><div className={`text-xl font-bold ${isRunning ? 'text-blue-500 animate-pulse' : ''}`}>{isRunning ? 'Running...' : 'Ready'}</div></CardContent></Card>
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Left Col: Config */}
        <div className="w-[300px] shrink-0 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Connection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pb-4">
              <div className="space-y-1">
                <Label className="text-xs">Base URL</Label>
                <Input className="h-8 text-sm" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">API Key</Label>
                <Input className="h-8 text-sm" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} />
              </div>
              <Button onClick={fetchModels} className="w-full h-8 text-xs" variant="secondary">Fetch Models</Button>
              <div className="space-y-1">
                <Label className="text-xs">Model</Label>
                <Select value={model} onValueChange={(val) => setModel(val || '')}>
                  <SelectTrigger className="h-8 text-sm">
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
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pb-4">
              <div className="space-y-1">
                <Label className="text-xs">Prompt</Label>
                <Textarea className="min-h-[60px] text-sm resize-none" value={prompt} onChange={e => setPrompt(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Max Tokens</Label>
                  <Input className="h-8 text-sm" type="number" value={maxTokens} onChange={e => setMaxTokens(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Concurrency</Label>
                  <Input className="h-8 text-sm" type="number" value={concurrency} onChange={e => setConcurrency(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Total Requests</Label>
                  <Input className="h-8 text-sm" type="number" value={totalRequests} onChange={e => setTotalRequests(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Ctx Padding</Label>
                  <Input className="h-8 text-sm" type="number" value={contextPadding} onChange={e => setContextPadding(e.target.value)} />
                </div>
              </div>
              <Button onClick={startTest} disabled={isRunning || !model} className="w-full h-8 mt-2">
                {isRunning ? 'Running...' : 'Start Test'}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Center Col: Charts & History */}
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          <div className="h-1/2 flex gap-4">
            <Card className="flex-1 flex flex-col shadow-sm">
              <CardHeader className="py-2 px-4 border-b">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">TPS Over Time</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metrics}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="id" tick={{fontSize: 10}} />
                    <YAxis tick={{fontSize: 10}} />
                    <Tooltip contentStyle={{fontSize: '12px'}} />
                    <Line type="monotone" dataKey="tps" stroke="#8884d8" name="TPS" dot={false} strokeWidth={2} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="flex-1 flex flex-col shadow-sm">
              <CardHeader className="py-2 px-4 border-b">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">Latency & TTFT</CardTitle>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metrics}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="id" tick={{fontSize: 10}} />
                    <YAxis tick={{fontSize: 10}} />
                    <Tooltip contentStyle={{fontSize: '12px'}} />
                    <Line type="monotone" dataKey="latency" stroke="#82ca9d" name="Total (ms)" dot={false} strokeWidth={2} isAnimationActive={false} />
                    <Line type="monotone" dataKey="ttft" stroke="#ffc658" name="TTFT (ms)" dot={false} strokeWidth={2} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <Card className="h-1/2 flex flex-col shadow-sm">
             <CardHeader className="py-2 px-4 border-b shrink-0">
               <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">Test History</CardTitle>
             </CardHeader>
             <CardContent className="flex-1 overflow-auto p-0">
               <Table>
                 <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10">
                   <TableRow>
                     <TableHead className="text-xs h-8">Time</TableHead>
                     <TableHead className="text-xs h-8">Model</TableHead>
                     <TableHead className="text-xs h-8">Conc.</TableHead>
                     <TableHead className="text-xs h-8">Pad</TableHead>
                     <TableHead className="text-xs h-8">S/E</TableHead>
                     <TableHead className="text-xs h-8">Avg TTFT</TableHead>
                     <TableHead className="text-xs h-8">Avg TPS</TableHead>
                     <TableHead className="text-xs h-8">P90 Lat</TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {history.map((record) => (
                     <TableRow key={record.id}>
                       <TableCell className="text-xs py-2">{record.timestamp}</TableCell>
                       <TableCell className="text-xs py-2 max-w-[100px] truncate" title={record.model}>{record.model}</TableCell>
                       <TableCell className="text-xs py-2">{record.concurrency}</TableCell>
                       <TableCell className="text-xs py-2">{record.contextPadding}</TableCell>
                       <TableCell className="text-xs py-2">{record.success}/{record.error}</TableCell>
                       <TableCell className="text-xs py-2">{record.avgTtft.toFixed(0)}ms</TableCell>
                       <TableCell className="text-xs py-2">{record.avgTps.toFixed(1)}</TableCell>
                       <TableCell className="text-xs py-2">{record.p90.toFixed(0)}ms</TableCell>
                     </TableRow>
                   ))}
                   {history.length === 0 && (
                     <TableRow>
                       <TableCell colSpan={8} className="text-center text-xs text-muted-foreground py-8">No tests run yet.</TableCell>
                     </TableRow>
                   )}
                 </TableBody>
               </Table>
             </CardContent>
          </Card>
        </div>

        {/* Right Col: Logs */}
        <div className="w-[350px] shrink-0 flex flex-col">
          <Card className="flex-1 flex flex-col shadow-sm">
             <CardHeader className="py-2 px-4 border-b shrink-0">
               <CardTitle className="text-xs font-semibold text-muted-foreground uppercase">Live Request Logs</CardTitle>
             </CardHeader>
             <CardContent className="flex-1 overflow-y-auto space-y-3 p-3 bg-muted/10">
               {logs.map((log, idx) => (
                 <div key={idx} className="border bg-card p-3 rounded-lg text-xs shadow-sm space-y-2">
                   <div className="font-semibold border-b pb-1 flex justify-between items-center">
                      <span>Req #{log.id}</span>
                      <span className="text-muted-foreground font-normal text-[10px]">Lat: {log.latency}{log.latency !== '...' && log.latency !== 'N/A' ? 'ms' : ''} | TTFT: {log.ttft}{log.ttft !== '...' && log.ttft !== 'N/A' ? 'ms' : ''}</span>
                   </div>
                   <div className="line-clamp-2"><span className="font-semibold text-blue-500 mr-1">Ask:</span><span className="text-muted-foreground">{log.prompt}</span></div>
                   <div className="whitespace-pre-wrap"><span className="font-semibold text-green-500 mr-1">Res:</span>{log.response}</div>
                 </div>
               ))}
               {logs.length === 0 && (
                 <div className="text-center text-muted-foreground py-8 text-xs">Awaiting requests...</div>
               )}
             </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
