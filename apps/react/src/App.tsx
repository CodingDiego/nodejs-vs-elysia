import { useCallback, useMemo, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type {
  BenchmarkResult,
  EventLoopProbe,
  FileHashResult,
  HashingStreamEvent,
  HeavyMixedResult,
  Job,
  PasswordHashResult,
  PasswordVerifyResult,
  Product,
} from "@repo/lab-core";
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
type StepKey =
  | "health"
  | "features"
  | "products"
  | "scraper"
  | "eventLoop"
  | "passwordHash"
  | "passwordVerify"
  | "fileHash"
  | "mixed"
  | "benchmark";
type StepStatus = "idle" | "running" | "done" | "error";
type Preset = {
  name: string;
  description: string;
  work: number;
  iterations: number;
  microtasks: number;
  passwordRounds: number;
  fileMb: number;
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
  { key: "passwordHash", label: "Password hash", icon: <KeyRound size={16} /> },
  { key: "passwordVerify", label: "Password verify", icon: <ShieldCheck size={16} /> },
  { key: "fileHash", label: "File hash", icon: <Cpu size={16} /> },
  { key: "mixed", label: "Mixed heavy", icon: <Sparkles size={16} /> },
  { key: "benchmark", label: "Benchmark", icon: <Gauge size={16} /> },
];

const presets: Preset[] = [
  {
    name: "Baseline",
    description: "Quick smoke test for local dev.",
    work: 18,
    iterations: 40,
    microtasks: 200,
    passwordRounds: 3,
    fileMb: 4,
  },
  {
    name: "Heavy",
    description: "More CPU and more benchmark samples.",
    work: 24,
    iterations: 120,
    microtasks: 1000,
    passwordRounds: 8,
    fileMb: 16,
  },
  {
    name: "Timer pressure",
    description: "Lots of microtasks to expose timer delay.",
    work: 20,
    iterations: 80,
    microtasks: 5000,
    passwordRounds: 6,
    fileMb: 12,
  },
  {
    name: "Stress",
    description: "Intentionally slower; good for visualizing blocking.",
    work: 28,
    iterations: 220,
    microtasks: 2500,
    passwordRounds: 14,
    fileMb: 32,
  },
];

const emptyHealth: BackendMap<Health> = { node: null, elysia: null };
const emptyProbe: BackendMap<EventLoopProbe> = { node: null, elysia: null };
const emptyBenchmark: BackendMap<BenchmarkResult> = { node: null, elysia: null };
const emptyJobs: BackendMap<Job> = { node: null, elysia: null };
const emptyPasswordHash: BackendMap<PasswordHashResult> = { node: null, elysia: null };
const emptyFileHash: BackendMap<FileHashResult> = { node: null, elysia: null };
const emptyMixed: BackendMap<HeavyMixedResult> = { node: null, elysia: null };
const emptyStatus: Record<BackendKey, BackendStatus> = { node: "idle", elysia: "idle" };
const emptyStepStatus: Record<BackendKey, Record<StepKey, StepStatus>> = {
  node: createStepStatus(),
  elysia: createStepStatus(),
};

function App() {
  return window.location.pathname === "/hashing" ? <HashingPage /> : <MainLabPage />;
}

function MainLabPage() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [work, setWork] = useState(18);
  const [iterations, setIterations] = useState(40);
  const [microtasks, setMicrotasks] = useState(200);
  const [passwordRounds, setPasswordRounds] = useState(3);
  const [fileMb, setFileMb] = useState(4);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [health, setHealth] = useState(emptyHealth);
  const [features, setFeatures] = useState<FeaturePayload | null>(null);
  const [eventLoop, setEventLoop] = useState(emptyProbe);
  const [benchmark, setBenchmark] = useState(emptyBenchmark);
  const [passwordHash, setPasswordHash] = useState(emptyPasswordHash);
  const [fileHashWork, setFileHashWork] = useState(emptyFileHash);
  const [mixedWork, setMixedWork] = useState(emptyMixed);
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

    if (step === "passwordHash") {
      const result = await requestBackend<PasswordHashResult>(backend, "/heavy/password-hash", {
        method: "POST",
        body: JSON.stringify({ rounds: passwordRounds, passwordLength: 128, keyLength: 64 }),
      });
      setPasswordHash((current) => ({ ...current, [backend.key]: result }));
      return `${result.rounds} hashes, p95 ${formatMs(result.p95Ms)}`;
    }

    if (step === "passwordVerify") {
      const result = await requestBackend<PasswordVerifyResult>(backend, "/heavy/password-verify", {
        method: "POST",
        body: JSON.stringify({ rounds: passwordRounds, passwordLength: 128, keyLength: 64 }),
      });
      return `${result.verified}/${result.rounds} verified, total ${formatMs(result.totalMs)}`;
    }

    if (step === "fileHash") {
      const result = await requestBackend<FileHashResult>(backend, "/heavy/file-hash", {
        method: "POST",
        body: JSON.stringify({ mb: fileMb, chunkKb: 256 }),
      });
      setFileHashWork((current) => ({ ...current, [backend.key]: result }));
      return `${result.mb}MB, ${result.throughputMbSec} MB/s`;
    }

    if (step === "mixed") {
      const result = await requestBackend<HeavyMixedResult>(backend, "/heavy/mixed", {
        method: "POST",
        body: JSON.stringify({ rounds: Math.max(1, Math.floor(passwordRounds / 2)), passwordLength: 128, mb: fileMb }),
      });
      setMixedWork((current) => ({ ...current, [backend.key]: result }));
      return `password + verify + ${result.file.mb}MB in ${formatMs(result.totalMs)}`;
    }

    const result = await requestBackend<BenchmarkResult>(
      backend,
      `/benchmark?iterations=${config.iterations}&work=${config.work}`,
    );
    setBenchmark((current) => ({ ...current, [backend.key]: result }));
    return `p95 ${formatMs(result.p95Ms)}, max ${formatMs(result.maxMs)}`;
  }, [fileMb, passwordRounds]);

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
    setPasswordRounds(preset.passwordRounds);
    setFileMb(preset.fileMb);
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
          <a className="navButton" href="/hashing">
            <Cpu size={18} />
            Hashing lab
          </a>
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
          <NumberField label="Password rounds" min={1} max={60} value={passwordRounds} onChange={setPasswordRounds} />
          <NumberField label="File MB" min={1} max={96} value={fileMb} onChange={setFileMb} />
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
            passwordHash={passwordHash[backend.key]}
            fileHashWork={fileHashWork[backend.key]}
            mixedWork={mixedWork[backend.key]}
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

type HashingBackendState = {
  status: "idle" | "streaming" | "done" | "error";
  progress: number;
  elapsedMs: number;
  phase: HashingStreamEvent["phase"] | "idle";
  message: string;
  sha256: string;
  throughputMbSec: number | null;
  events: HashingStreamEvent[];
};

const emptyHashingState: Record<BackendKey, HashingBackendState> = {
  node: createHashingState(),
  elysia: createHashingState(),
};

function HashingPage() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [rounds, setRounds] = useState(8);
  const [fileMb, setFileMb] = useState(24);
  const [chunkKb, setChunkKb] = useState(256);
  const [states, setStates] = useState(emptyHashingState);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const leader = useMemo(() => {
    const node = states.node.status === "done" ? states.node.elapsedMs : null;
    const elysia = states.elysia.status === "done" ? states.elysia.elapsedMs : null;
    if (typeof node !== "number" || typeof elysia !== "number") return "waiting for both streams";
    if (node === elysia) return "tie";
    return node < elysia ? "Node.js finished first" : "Elysia finished first";
  }, [states]);

  const runHashing = useCallback(async () => {
    setRunning(true);
    setError("");
    setStates({ node: createHashingState(), elysia: createHashingState() });

    try {
      await Promise.all(backends.map((backend) => streamHashingBenchmark(backend, { rounds, fileMb, chunkKb }, setStates)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Hashing stream failed");
    } finally {
      setRunning(false);
    }
  }, [chunkKb, fileMb, rounds]);

  const applyHashPreset = useCallback((nextRounds: number, nextFileMb: number, nextChunkKb: number) => {
    setRounds(nextRounds);
    setFileMb(nextFileMb);
    setChunkKb(nextChunkKb);
  }, []);

  return (
    <main className="appShell hashingShell" data-theme={theme}>
      <section className="hashHero">
        <div>
          <p className="eyebrow">Dedicated streaming benchmark</p>
          <h1>Hashing lab</h1>
          <p className="lede">
            Password derivation, verification, and generated file hashing stream progress as NDJSON from each backend.
          </p>
        </div>
        <div className="commandBar">
          <button type="button" className="themeButton" onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <a className="navButton" href="/">
            <Activity size={18} />
            Main lab
          </a>
          <button type="button" className="primary" onClick={runHashing} disabled={running}>
            {running ? <RefreshCw className="spin" size={18} /> : <Play size={18} />}
            Run hashing stream
          </button>
        </div>
      </section>

      <section className="hashControls">
        <div className="presetRail">
          <button type="button" className="presetButton" onClick={() => applyHashPreset(4, 8, 256)} disabled={running}>
            <Sparkles size={15} />
            <span>Warmup</span>
            <small>Fast local signal.</small>
          </button>
          <button type="button" className="presetButton" onClick={() => applyHashPreset(10, 32, 256)} disabled={running}>
            <Sparkles size={15} />
            <span>Heavy hashing</span>
            <small>More password rounds and file bytes.</small>
          </button>
          <button type="button" className="presetButton" onClick={() => applyHashPreset(16, 64, 128)} disabled={running}>
            <Sparkles size={15} />
            <span>Chunk pressure</span>
            <small>More stream updates.</small>
          </button>
          <button type="button" className="presetButton" onClick={() => applyHashPreset(24, 96, 256)} disabled={running}>
            <Sparkles size={15} />
            <span>Stress</span>
            <small>Slow enough to watch clearly.</small>
          </button>
        </div>

        <div className="controlInputs">
          <NumberField label="Password rounds" min={1} max={60} value={rounds} onChange={setRounds} />
          <NumberField label="File MB" min={1} max={128} value={fileMb} onChange={setFileMb} />
          <NumberField label="Chunk KB" min={16} max={1024} value={chunkKb} onChange={setChunkKb} />
          <div className="winner">
            <span>Current leader</span>
            <strong>{leader}</strong>
          </div>
        </div>
      </section>

      {error ? <div className="notice error">{error}</div> : null}

      <section className="hashGrid">
        {backends.map((backend) => (
          <HashingPanel key={backend.key} backend={backend} state={states[backend.key]} />
        ))}
      </section>
    </main>
  );
}

function HashingPanel({ backend, state }: { backend: Backend; state: HashingBackendState }) {
  return (
    <article className="hashPanel" style={{ "--accent": backend.accent } as CSSProperties}>
      <header className="backendHeader">
        <div>
          <span>{backend.runtime}</span>
          <h2>{backend.framework}</h2>
        </div>
        <KeyRound size={28} />
      </header>

      <div className={`hashProgress ${state.status}`}>
        <div className="hashProgressRing" style={{ "--progress": `${state.progress}%` } as CSSProperties}>
          <strong>{state.progress}%</strong>
        </div>
        <div>
          <span>{state.phase}</span>
          <p>{state.message || "Ready to stream hashing events."}</p>
        </div>
      </div>

      <div className="metricGrid">
        <Metric icon={<Clock3 size={18} />} label="Elapsed" value={formatMs(state.elapsedMs || undefined)} />
        <Metric icon={<Cpu size={18} />} label="Throughput" value={state.throughputMbSec ? `${state.throughputMbSec} MB/s` : "pending"} />
      </div>

      <div className="hashDigest">
        <span>Final SHA-256</span>
        <code>{state.sha256 ? state.sha256.slice(0, 48) : "pending"}</code>
      </div>

      <div className="streamLog">
        {state.events.length === 0 ? <p className="emptyFeed">Waiting for stream chunks.</p> : null}
        {state.events.map((event, index) => (
          <div key={`${event.phase}-${event.current}-${index}`} className="streamEvent">
            <span>{event.phase}</span>
            <strong>{event.message}</strong>
            <small>{formatMs(event.elapsedMs)}</small>
          </div>
        ))}
      </div>
    </article>
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
  passwordHash,
  fileHashWork,
  mixedWork,
  job,
  fileHash,
}: {
  backend: Backend;
  health: Health | null;
  status: BackendStatus;
  eventLoop: EventLoopProbe | null;
  benchmark: BenchmarkResult | null;
  passwordHash: PasswordHashResult | null;
  fileHashWork: FileHashResult | null;
  mixedWork: HeavyMixedResult | null;
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
        <Metric icon={<KeyRound size={18} />} label="Password p95" value={formatMs(passwordHash?.p95Ms)} />
        <Metric icon={<Cpu size={18} />} label="File hash" value={fileHashWork ? `${fileHashWork.throughputMbSec} MB/s` : "pending"} />
      </div>

      <div className="rows">
        <Row label="Sync CPU" value={formatMs(eventLoop?.syncMs)} />
        <Row label="Async wait" value={formatMs(eventLoop?.asyncWaitMs)} />
        <Row label="Benchmark p50" value={formatMs(benchmark?.p50Ms)} />
        <Row label="Benchmark max" value={formatMs(benchmark?.maxMs)} />
        <Row label="Password total" value={formatMs(passwordHash?.totalMs)} />
        <Row label="File total" value={formatMs(fileHashWork?.totalMs)} />
        <Row label="Mixed heavy" value={formatMs(mixedWork?.totalMs)} />
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

function createHashingState(): HashingBackendState {
  return {
    status: "idle",
    progress: 0,
    elapsedMs: 0,
    phase: "idle",
    message: "",
    sha256: "",
    throughputMbSec: null,
    events: [],
  };
}

async function streamHashingBenchmark(
  backend: Backend,
  config: { rounds: number; fileMb: number; chunkKb: number },
  setStates: Dispatch<SetStateAction<Record<BackendKey, HashingBackendState>>>,
) {
  setStates((current) => ({
    ...current,
    [backend.key]: { ...current[backend.key], status: "streaming", message: "Opening stream..." },
  }));

  const params = new URLSearchParams({
    rounds: String(config.rounds),
    passwordLength: "128",
    keyLength: "64",
    fileMb: String(config.fileMb),
    chunkKb: String(config.chunkKb),
  });
  const response = await fetch(`${backend.url}/heavy/hashing-stream?${params}`, {
    signal: AbortSignal.timeout(180000),
  });

  if (!response.ok || !response.body) {
    throw new Error(`${backend.name} hashing stream failed with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let lastEvent: HashingStreamEvent | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as HashingStreamEvent;
      lastEvent = event;

      setStates((current) => ({
        ...current,
        [backend.key]: {
          ...current[backend.key],
          status: event.phase === "summary" ? "done" : "streaming",
          progress: event.progress,
          elapsedMs: event.elapsedMs,
          phase: event.phase,
          message: event.message,
          sha256: event.sha256 ?? current[backend.key].sha256,
          throughputMbSec: event.throughputMbSec ?? current[backend.key].throughputMbSec,
          events: [event, ...current[backend.key].events].slice(0, 32),
        },
      }));
    }
  }

  setStates((current) => ({
    ...current,
    [backend.key]: {
      ...current[backend.key],
      status: lastEvent?.phase === "summary" ? "done" : "error",
      message: lastEvent?.message ?? "Stream ended without summary.",
    },
  }));
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
    passwordHash: "idle",
    passwordVerify: "idle",
    fileHash: "idle",
    mixed: "idle",
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
