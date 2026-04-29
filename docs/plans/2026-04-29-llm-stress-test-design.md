# LLM Stress Test Application Design

## Overview
A web-based stress testing tool designed to test local LLMs directly via their OpenAI-compatible APIs. The application will measure critical performance metrics under concurrent load.

## Architecture & Tech Stack
- **Framework:** Next.js (App Router) for both the frontend dashboard and backend test execution.
- **Styling & UI:** TailwindCSS, `shadcn/ui` for components, and `recharts` for real-time charting.
- **Execution Engine:** Custom Node.js logic within Next.js API Routes (Route Handlers). It will use standard asynchronous `fetch` requests configured to stream responses.
- **Real-time Communication:** Server-Sent Events (SSE) to push live metrics from the Next.js backend to the browser during the test.

## Data Flow & Testing Logic
- **Target:** Direct connection to local LLMs (e.g., vLLM, Ollama, llama.cpp) via OpenAI-style endpoints.
- **Concurrency Handling:** The backend will utilize a worker pool or concurrency limiter to ensure exactly `N` requests are simultaneously in-flight until the total request count is met.
- **Metrics Calculated per Request:**
  - **TTFT (Time To First Token):** Time elapsed from request dispatch to receiving the first streamed token chunk.
  - **TPS (Tokens Per Second):** Total tokens generated divided by the duration of the generation phase (Total Time - TTFT).
  - **Total Latency:** Complete round-trip time.
  - **Status:** Success (200 OK) vs. Failure (4xx, 5xx, timeouts).

## Frontend UI & Configuration
- **Dashboard Layout:** A clean, dark-mode developer dashboard.
- **Configuration Panel:**
  - **Connection:** Base URL and API Key.
  - **Model Selection:** The app will automatically query the `/v1/models` endpoint using the provided Base URL and API Key to populate a dropdown, allowing the user to select specific models for each test run.
  - **Context Window:** Fields for Prompt input, `max_tokens`, and `temperature`. 
  - **Stress Parameters:** Concurrency Level and Total Number of Requests.
- **Results & Visualization:**
  - **Real-Time Charts:** Line charts plotting TPS and Latency/TTFT over time.
  - **Summary Table:** Displays P50, P90, P99 percentiles for latency, average TPS, and a summary of success/error counts.
