import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { BenchmarkResult, EventLoopProbe, Job, Product } from "@repo/lab-core";
import {
  Activity,
  Braces,
  CheckCircle2,
  Clock3,
  Cpu,
  Gauge,
  KeyRound,
  Layers3,
  Moon,
  Play,
  RadioTower,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  TimerReset,
  XCircle,
  Zap,
} from "lucide-react";
import "./App.css";

type BackendKey = "node" | "elysia";
type Backend = {
  key: BackendKey;
  name: string;
  framework: string;
  runtime: string;
  url: string;
  accent: string;
};
type Theme = "light" | "dark";
type Health = {
  ok: boolean;
  framework: string;
  runtime: string;
  uptime: number;
};
type FeaturePayload = {
  capabilities: string[];
  learningRoute: string[];
};
type FileProbe = {
  sha256: string;
  bytes: number;
  lines: number;
};
type ProductPayload = {
  data: Product[];
};
type ScraperPayload = {
  source: string;
  capturedAt: string;
  data: Array<{ sku: string; title: string; observedPrice: number }>;
};
type BackendMap<T> = Record<BackendKey, T | null>;
type BackendStatus = "idle" | "running" | "online" | "error";
type BusyAction = "compare" | "auth" | "jobs" | "file" | null;
type StepKey = "health" | "features" | "products" | "scraper" | "eventLoop" | "benchmark";
type StepStatus = "idle" | "running" | "done" | "error";
type Preset = {
  name: string;
  description: string;
  work: number;
  iterations: number;
  microtasks: number;
};
type FeedEntry = {
  id: string;
  backend: BackendKey;
  label: string;
  status: Exclude<StepStatus, "idle">;
  detail: string;
};

const backends: Backend[] = [
  {
    key: "node",
    name: "Node.js API",
    framework: "Express",
    runtime: "Node.js",
    url: import.meta.env.VITE_NODE_API_URL ?? "http://localhost:4001",
    accent: "#3b82f6",
  },
  {
    key: "elysia",
    name: "Elysia API",
    framework: "Elysia",
    runtime: "Bun",
    url: import.meta.env.VITE_ELYSIA_API_URL ?? "http://localhost:4002",
    accent: "#22c55e",
  },
];

const steps: Array<{ key: StepKey; label: string; icon: ReactNode }> = [
  { key: "health", label: "Health", icon: <Activity size={16} /> },
  { key: "features", label: "Features", icon: <Layers3 size={16} /> },
  { key: "products", label: "Products", icon: <Braces size={16} /> },
  { key: "scraper", label: "Scraper", icon: <RadioTower size={16} /> },
  { key: "eventLoop", label: "Event loop", icon: <TimerReset size={16} /> },
  { key: "benchmark", label: "Benchmark", icon: <Gauge size={16} /> },
];

const presets: Preset[] = [
  {
    name: "Baseline",
    description: "Quick smoke test for local dev.",
    work: 18,
    iterations: 40,
    microtasks: 200,
  },
  {
    name: "Heavy",
    description: "More CPU and more benchmark samples.",
    work: 24,
    iterations: 120,
    microtasks: 1000,
  },
  {
    name: "Timer pressure",
    description: "Lots of microtasks to expose timer delay.",
    work: 20,
    iterations: 80,
    microtasks: 5000,
  },
  {
    name: "Stress",
    description: "Intentionally slower; good for visualizing blocking.",
    work: 28,
    iterations: 220,
    microtasks: 2500,
  },
];

const emptyHealth: BackendMap<Health> = { node: null, elysia: null };
const emptyProbe: BackendMap<EventLoopProbe> = { node: null, elysia: null };
const emptyBenchmark: BackendMap<BenchmarkResult> = { node: null, elysia: null };
const emptyJobs: BackendMap<Job> = { node: null, elysia: null };
const emptyStatus: Record<BackendKey, BackendStatus> = { node: "idle", elysia: "idle" };
const emptyStepStatus: Record<BackendKey, Record<StepKey, StepStatus>> = {
  node: createStepStatus(),
  elysia: createStepStatus(),
};

function App() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [work, setWork] = useState(18);
  const [iterations, setIterations] = useState(40);
  const [microtasks, setMicrotasks] = useState(200);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [health, setHealth] = useState(emptyHealth);
  const [features, setFeatures] = useState<FeaturePayload | null>(null);
  const [eventLoop, setEventLoop] = useState(emptyProbe);
  const [benchmark, setBenchmark] = useState(emptyBenchmark);
  const [jobs, setJobs] = useState(emptyJobs);
  const [backendStatus, setBackendStatus] = useState(emptyStatus);
  const [stepStatus, setStepStatus] = useState(emptyStepStatus);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [fileHashes, setFileHashes] = useState<BackendMap<FileProbe>>({
    node: null,
    elysia: null,
  });

  const winner = useMemo(() => {
    const nodeP95 = benchmark.node?.p95Ms;
    const elysiaP95 = benchmark.elysia?.p95Ms;
    if (typeof nodeP95 !== "number" || typeof elysiaP95 !== "number") return "waiting for both p95 values";
    if (nodeP95 === elysiaP95) return "tie";
    return nodeP95 < elysiaP95 ? "Node.js p95 lower" : "Elysia p95 lower";
  }, [benchmark]);

  const progress = useMemo(() => {
    const statuses = Object.values(stepStatus).flatMap((backendSteps) => Object.values(backendSteps));
    const completed = statuses.filter((status) => status === "done").length;
    return Math.round((completed / statuses.length) * 100);
  }, [stepStatus]);

  const setStep = useCallback((backend: BackendKey, step: StepKey, status: StepStatus) => {
    setStepStatus((current) => ({
      ...current,
      [backend]: {
        ...current[backend],
        [step]: status,
      },
    }));
  }, []);

  const addFeed = useCallback((backend: BackendKey, label: string, status: Exclude<StepStatus, "idle">, detail: string) => {
    setFeed((current) => [
      {
        id: crypto.randomUUID(),
        backend,
        label,
        status,
        detail,
      },
      ...current,
    ].slice(0, 12));
  }, []);

  const runStep = useCallback(async (
    backend: Backend,
    step: StepKey,
    config: { work: number; iterations: number; microtasks: number },
  ) => {
    if (step === "health") {
      const result = await requestBackend<Health>(backend, "/health");
      setHealth((current) => ({ ...current, [backend.key]: result }));
      return `${result.runtime} online`;
    }

    if (step === "features") {
      const result = await requestBackend<FeaturePayload>(backend, "/features");
      setFeatures((current) => current ?? result);
      return `${result.capabilities.length} capabilities`;
    }

    if (step === "products") {
      const result = await requestBackend<ProductPayload>(backend, "/products");
      return `${result.data.length} products`;
    }

    if (step === "scraper") {
      const result = await requestBackend<ScraperPayload>(backend, "/scraper/prices");
      return `${result.data.length} prices from ${result.source}`;
    }

    if (step === "eventLoop") {
      const result = await requestBackend<EventLoopProbe>(
        backend,
        `/event-loop?work=${config.work}&microtasks=${config.microtasks}`,
      );
      setEventLoop((current) => ({ ...current, [backend.key]: result }));
      return `total ${formatMs(result.totalMs)}, timer ${formatMs(result.timerDelayMs)}`;
    }

    const result = await requestBackend<BenchmarkResult>(
      backend,
      `/benchmark?iterations=${config.iterations}&work=${config.work}`,
    );
    setBenchmark((current) => ({ ...current, [backend.key]: result }));
    return `p95 ${formatMs(result.p95Ms)}, max ${formatMs(result.maxMs)}`;
  }, []);

  const runComparison = useCallback(async () => {
    setBusy("compare");
    setError("");
    setFeed([]);
    setStepStatus({ node: createStepStatus(), elysia: createStepStatus() });
    setBackendStatus({ node: "running", elysia: "idle" });

    for (const backend of backends) {
      setBackendStatus((current) => ({ ...current, [backend.key]: "running" }));

      for (const step of steps) {
        setStep(backend.key, step.key, "running");

        try {
          const detail = await runStep(backend, step.key, { work, iterations, microtasks });
          setStep(backend.key, step.key, "done");
          addFeed(backend.key, step.label, "done", detail);
          await delay(180);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Unexpected step failure";
          setStep(backend.key, step.key, "error");
          setBackendStatus((current) => ({ ...current, [backend.key]: "error" }));
          addFeed(backend.key, step.label, "error", message);
          setError(message);
          break;
        }
      }

      setBackendStatus((current) => ({
        ...current,
        [backend.key]: current[backend.key] === "error" ? "error" : "online",
      }));
    }

    setBusy(null);
  }, [addFeed, iterations, microtasks, runStep, setStep, work]);

  const runMutation = useCallback(async <T,>(
    action: Exclude<BusyAction, "compare" | null>,
    path: string,
    init: RequestInit,
    onResult: (result: BackendMap<T>) => void,
  ) => {
    setBusy(action);
    setError("");
    setBackendStatus({ node: "running", elysia: "running" });

    try {
      const responses = await compare<T>(path, init);
      onResult(responses);
      setBackendStatus({
        node: responses.node ? "online" : "error",
        elysia: responses.elysia ? "online" : "error",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not run ${action}`);
    } finally {
      setBusy(null);
    }
  }, []);

  const createAdminToken = useCallback(async () => {
    void runMutation<{ token: string }>(
      "auth",
      "/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email: "demo@example.com", role: "admin" }),
      },
      (responses) => setToken(responses.node?.token ?? responses.elysia?.token ?? ""),
    );
  }, [runMutation]);

  const enqueueJobs = useCallback(async () => {
    void runMutation<Job>(
      "jobs",
      "/jobs",
      {
        method: "POST",
        body: JSON.stringify({ kind: "order", payload: { source: "react-dashboard" } }),
      },
      setJobs,
    );
  }, [runMutation]);

  const analyzeFile = useCallback(async () => {
    void runMutation<FileProbe>(
      "file",
      "/files/analyze",
      {
        method: "POST",
        body: JSON.stringify({
          filename: "event-loop-notes.md",
          content: "Node runs JavaScript on an event loop.\nBun runs Elysia with a fast Fetch runtime.\nMeasure before claiming.",
        }),
      },
      setFileHashes,
    );
  }, [runMutation]);

  const applyPreset = useCallback((preset: Preset) => {
    setWork(preset.work);
    setIterations(preset.iterations);
    setMicrotasks(preset.microtasks);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return (
    <main className="appShell" data-theme={theme}>
      <section className="summaryBand">
        <div className="summaryCopy">
          <p className="eyebrow">Runtime comparison lab</p>
          <h1>Node.js vs Elysia</h1>
          <p className="lede">
            Sequential, visible probes across the same API surface. Watch each backend move through health,
            metadata, I/O simulation, event loop pressure, and p95 benchmarking.
          </p>
        </div>

        <div className="commandBar">
          <button type="button" className="themeButton" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button type="button" className="primary" onClick={runComparison} disabled={busy !== null}>
            {busy === "compare" ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}
            Run comparison
          </button>
          <button type="button" onClick={createAdminToken} disabled={busy !== null}>
            <KeyRound size={18} />
            Auth
          </button>
          <button type="button" onClick={enqueueJobs} disabled={busy !== null}>
            <Zap size={18} />
            Jobs
          </button>
          <button type="button" onClick={analyzeFile} disabled={busy !== null}>
            <Braces size={18} />
            File probe
          </button>
        </div>
      </section>

      <section className="controls">
        <div className="presetRail">
          {presets.map((preset) => (
            <button key={preset.name} type="button" className="presetButton" onClick={() => applyPreset(preset)} disabled={busy !== null}>
              <Sparkles size={15} />
              <span>{preset.name}</span>
              <small>{preset.description}</small>
            </button>
          ))}
        </div>

        <div className="controlInputs">
          <NumberField label="CPU work" min={5} max={34} value={work} onChange={setWork} />
          <NumberField label="Iterations" min={1} max={500} value={iterations} onChange={setIterations} />
          <NumberField label="Microtasks" min={0} max={5000} value={microtasks} onChange={setMicrotasks} />
          <div className="winner">
            <span>Sequential progress</span>
            <strong>{progress}%</strong>
          </div>
          <div className="winner">
            <span>Current p95 result</span>
            <strong>{winner}</strong>
          </div>
        </div>
      </section>

      {error ? <div className="notice error">{error}</div> : null}
      {token ? <div className="notice token">Admin token ready: {token.slice(0, 34)}...</div> : null}

      <section className="stage">
        <div className="timeline">
          {backends.map((backend) => (
            <TimelineColumn
              key={backend.key}
              backend={backend}
              status={backendStatus[backend.key]}
              steps={stepStatus[backend.key]}
            />
          ))}
        </div>

        <div className="feedPanel">
          <div className="blockTitle">
            <RadioTower size={20} />
            <h2>Execution feed</h2>
          </div>
          <div className="feedList">
            {feed.length === 0 ? <p className="emptyFeed">Run a comparison to watch the sequence.</p> : null}
            {feed.map((entry) => (
              <div key={entry.id} className={`feedItem ${entry.status}`}>
                <span>{entry.backend}</span>
                <strong>{entry.label}</strong>
                <p>{entry.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="backendGrid">
        {backends.map((backend) => (
          <BackendPanel
            key={backend.key}
            backend={backend}
            health={health[backend.key]}
            status={backendStatus[backend.key]}
            eventLoop={eventLoop[backend.key]}
            benchmark={benchmark[backend.key]}
            job={jobs[backend.key]}
            fileHash={fileHashes[backend.key]}
          />
        ))}
      </section>

      <section className="detailsGrid">
        <div className="detailBlock">
          <div className="blockTitle">
            <Layers3 size={20} />
            <h2>Backend surface</h2>
          </div>
          <ul>
            {(features?.capabilities ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="detailBlock">
          <div className="blockTitle">
            <ShieldCheck size={20} />
            <h2>RSC note</h2>
          </div>
          <p className="rscNote">
            This app is Vite, so it cannot run React Server Components directly. The data calls are now isolated
            behind a small runner, which is the part we would move into RSC loaders if we migrate this frontend to Next.
          </p>
        </div>
      </section>
    </main>
  );
}

function TimelineColumn({
  backend,
  status,
  steps: backendSteps,
}: {
  backend: Backend;
  status: BackendStatus;
  steps: Record<StepKey, StepStatus>;
}) {
  return (
    <div className="timelineColumn" style={{ "--accent": backend.accent } as CSSProperties}>
      <div className="timelineHeader">
        <Server size={20} />
        <div>
          <strong>{backend.name}</strong>
          <span>{status}</span>
        </div>
      </div>
      <div className="timelineSteps">
        {steps.map((step) => (
          <div key={step.key} className={`timelineStep ${backendSteps[step.key]}`}>
            <div className="stepIcon">
              {backendSteps[step.key] === "done" ? <CheckCircle2 size={16} /> : null}
              {backendSteps[step.key] === "error" ? <XCircle size={16} /> : null}
              {backendSteps[step.key] === "running" ? <RefreshCw className="spin" size={16} /> : null}
              {backendSteps[step.key] === "idle" ? step.icon : null}
            </div>
            <span>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BackendPanel({
  backend,
  health,
  status,
  eventLoop,
  benchmark,
  job,
  fileHash,
}: {
  backend: Backend;
  health: Health | null;
  status: BackendStatus;
  eventLoop: EventLoopProbe | null;
  benchmark: BenchmarkResult | null;
  job: Job | null;
  fileHash: FileProbe | null;
}) {
  return (
    <article className="backendPanel" style={{ "--accent": backend.accent } as CSSProperties}>
      <header className="backendHeader">
        <div>
          <span>{backend.framework}</span>
          <h2>{backend.name}</h2>
        </div>
        <Cpu size={26} />
      </header>

      <p className="runtime">{backend.runtime}</p>
      <code className="endpoint">{backend.url}</code>

      <div className="metricGrid">
        <Metric icon={<Activity size={18} />} label="Health" value={statusLabel(status, health)} />
        <Metric icon={<Clock3 size={18} />} label="Timer delay" value={formatMs(eventLoop?.timerDelayMs)} />
        <Metric icon={<Gauge size={18} />} label="Event total" value={formatMs(eventLoop?.totalMs)} />
        <Metric icon={<Zap size={18} />} label="Benchmark p95" value={formatMs(benchmark?.p95Ms)} />
      </div>

      <div className="rows">
        <Row label="Sync CPU" value={formatMs(eventLoop?.syncMs)} />
        <Row label="Async wait" value={formatMs(eventLoop?.asyncWaitMs)} />
        <Row label="Benchmark p50" value={formatMs(benchmark?.p50Ms)} />
        <Row label="Benchmark max" value={formatMs(benchmark?.maxMs)} />
        <Row label="Last job" value={job ? `${job.kind} / ${job.status}` : "not queued"} />
        <Row label="File SHA" value={fileHash ? fileHash.sha256.slice(0, 16) : "not analyzed"} />
      </div>
    </article>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metricIcon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NumberField({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="numberField">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}

async function compare<T>(path: string, init?: RequestInit): Promise<BackendMap<T>> {
  const entries = await Promise.allSettled(
    backends.map(async (backend) => {
      return [backend.key, await requestBackend<T>(backend, path, init)] as const;
    }),
  );

  const output: BackendMap<T> = { node: null, elysia: null };
  const failures: string[] = [];

  for (const entry of entries) {
    if (entry.status === "fulfilled") {
      output[entry.value[0]] = entry.value[1];
    } else {
      failures.push(entry.reason instanceof Error ? entry.reason.message : "Unknown backend error");
    }
  }

  if (failures.length === backends.length) {
    throw new Error(failures.join(" | "));
  }

  return output;
}

async function requestBackend<T>(backend: Backend, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");

  const response = await fetch(`${backend.url}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`${backend.name} ${path} failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function createStepStatus(): Record<StepKey, StepStatus> {
  return {
    health: "idle",
    features: "idle",
    products: "idle",
    scraper: "idle",
    eventLoop: "idle",
    benchmark: "idle",
  };
}

function formatMs(value?: number) {
  if (typeof value !== "number") return "pending";
  return `${value.toFixed(2)} ms`;
}

function statusLabel(status: BackendStatus, health: Health | null) {
  if (status === "running") return "running";
  if (status === "error") return "error";
  if (health?.ok) return "online";
  return "idle";
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default App;
