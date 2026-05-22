import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { BenchmarkResult, EventLoopProbe, Job } from "@repo/lab-core";
import {
  Activity,
  Braces,
  Clock3,
  Gauge,
  KeyRound,
  Layers3,
  Play,
  RefreshCw,
  Server,
  ShieldCheck,
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
type BackendMap<T> = Record<BackendKey, T | null>;
type BusyAction = "compare" | "auth" | "jobs" | "file" | null;

const backends: Backend[] = [
  {
    key: "node",
    name: "Node.js API",
    framework: "Express",
    runtime: "Node.js",
    url: import.meta.env.VITE_NODE_API_URL ?? "http://localhost:4001",
    accent: "#2563eb",
  },
  {
    key: "elysia",
    name: "Elysia API",
    framework: "Elysia",
    runtime: "Bun",
    url: import.meta.env.VITE_ELYSIA_API_URL ?? "http://localhost:4002",
    accent: "#16a34a",
  },
];

const emptyHealth: BackendMap<Health> = { node: null, elysia: null };
const emptyProbe: BackendMap<EventLoopProbe> = { node: null, elysia: null };
const emptyBenchmark: BackendMap<BenchmarkResult> = { node: null, elysia: null };
const emptyJobs: BackendMap<Job> = { node: null, elysia: null };

function App() {
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
  const [fileHashes, setFileHashes] = useState<BackendMap<{ sha256: string; bytes: number; lines: number }>>({
    node: null,
    elysia: null,
  });

  const winner = useMemo(() => {
    const nodeP95 = benchmark.node?.p95Ms;
    const elysiaP95 = benchmark.elysia?.p95Ms;
    if (typeof nodeP95 !== "number" || typeof elysiaP95 !== "number") return "pending";
    if (nodeP95 === elysiaP95) return "tie";
    return nodeP95 < elysiaP95 ? "Node.js p95 lower" : "Elysia p95 lower";
  }, [benchmark]);

  const runComparison = useCallback(async () => {
    setBusy("compare");
    setError("");

    try {
      const [healthResult, featureResult, eventResult, benchmarkResult] = await Promise.all([
        compare<Health>("/health"),
        compare<FeaturePayload>("/features"),
        compare<EventLoopProbe>(`/event-loop?work=${work}&microtasks=${microtasks}`),
        compare<BenchmarkResult>(`/benchmark?iterations=${iterations}&work=${work}`),
      ]);

      setHealth(healthResult);
      setFeatures(featureResult.node ?? featureResult.elysia);
      setEventLoop(eventResult);
      setBenchmark(benchmarkResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected comparison error");
    } finally {
      setBusy(null);
    }
  }, [iterations, microtasks, work]);

  const createAdminToken = useCallback(async () => {
    setBusy("auth");
    setError("");

    try {
      const responses = await compare<{ token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: "demo@example.com", role: "admin" }),
      });

      setToken(responses.node?.token ?? responses.elysia?.token ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create auth token");
    } finally {
      setBusy(null);
    }
  }, []);

  const enqueueJobs = useCallback(async () => {
    setBusy("jobs");
    setError("");

    try {
      const responses = await compare<Job>("/jobs", {
        method: "POST",
        body: JSON.stringify({ kind: "order", payload: { source: "react-dashboard" } }),
      });

      setJobs(responses);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not enqueue demo jobs");
    } finally {
      setBusy(null);
    }
  }, []);

  const analyzeFile = useCallback(async () => {
    setBusy("file");
    setError("");

    try {
      const responses = await compare<{ sha256: string; bytes: number; lines: number }>("/files/analyze", {
        method: "POST",
        body: JSON.stringify({
          filename: "event-loop-notes.md",
          content: "Node runs JavaScript on an event loop.\nBun runs Elysia with a fast Fetch runtime.\nMeasure before claiming.",
        }),
      });

      setFileHashes(responses);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not analyze file payload");
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <main className="appShell">
      <section className="summaryBand">
        <div className="summaryCopy">
          <p className="eyebrow">Runtime comparison lab</p>
          <h1>Node.js vs Elysia</h1>
          <p className="lede">
            Misma superficie de API, dos frameworks distintos. La demo ejercita event loop, validacion,
            auth, jobs, streams, archivos y mediciones p50/p95 para mostrar criterio backend.
          </p>
        </div>

        <div className="commandBar">
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
        <NumberField label="CPU work" min={5} max={34} value={work} onChange={setWork} />
        <NumberField label="Iterations" min={1} max={500} value={iterations} onChange={setIterations} />
        <NumberField label="Microtasks" min={0} max={5000} value={microtasks} onChange={setMicrotasks} />
        <div className="winner">
          <span>Current p95 result</span>
          <strong>{winner}</strong>
        </div>
      </section>

      {error ? <div className="notice error">{error}</div> : null}
      {token ? <div className="notice token">Admin token ready: {token.slice(0, 34)}...</div> : null}

      <section className="backendGrid">
        {backends.map((backend) => (
          <BackendPanel
            key={backend.key}
            backend={backend}
            health={health[backend.key]}
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
            <h2>Learning route</h2>
          </div>
          <ol>
            {(features?.learningRoute ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}

function BackendPanel({
  backend,
  health,
  eventLoop,
  benchmark,
  job,
  fileHash,
}: {
  backend: Backend;
  health: Health | null;
  eventLoop: EventLoopProbe | null;
  benchmark: BenchmarkResult | null;
  job: Job | null;
  fileHash: { sha256: string; bytes: number; lines: number } | null;
}) {
  return (
    <article className="backendPanel" style={{ "--accent": backend.accent } as CSSProperties}>
      <header className="backendHeader">
        <div>
          <span>{backend.framework}</span>
          <h2>{backend.name}</h2>
        </div>
        <Server size={26} />
      </header>

      <p className="runtime">{backend.runtime}</p>
      <code className="endpoint">{backend.url}</code>

      <div className="metricGrid">
        <Metric icon={<Activity size={18} />} label="Health" value={health?.ok ? "online" : "pending"} />
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
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");

  const entries = await Promise.all(
    backends.map(async (backend) => {
      const response = await fetch(`${backend.url}${path}`, { ...init, headers });

      if (!response.ok) {
        throw new Error(`${backend.name} ${path} failed with ${response.status}`);
      }

      return [backend.key, (await response.json()) as T] as const;
    }),
  );

  return Object.fromEntries(entries) as BackendMap<T>;
}

function formatMs(value?: number) {
  if (typeof value !== "number") return "pending";
  return `${value.toFixed(2)} ms`;
}

export default App;
