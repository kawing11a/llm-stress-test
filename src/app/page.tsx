import Dashboard from "@/components/Dashboard";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold mb-8 text-center">LLM Stress Test</h1>
        <Dashboard />
      </div>
    </main>
  );
}
