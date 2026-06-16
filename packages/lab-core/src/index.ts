export type Role = "admin" | "operator" | "viewer";
export type JobKind = "email" | "pdf" | "image" | "order";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export type Product = {
  id: string;
  name: string;
  price: number;
  stock: number;
};

export type Sale = {
  id: string;
  productId: string;
  quantity: number;
  total: number;
  createdAt: string;
};

export type Job = {
  id: string;
  kind: JobKind;
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  createdAt: string;
  finishedAt?: string;
};

export type EventLoopProbe = {
  work: number;
  microtasks: number;
  fibValue: number;
  syncMs: number;
  timerDelayMs: number;
  asyncWaitMs: number;
  totalMs: number;
  explanation: string;
};

export type BenchmarkResult = {
  iterations: number;
  work: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

export type PasswordHashResult = {
  rounds: number;
  passwordBytes: number;
  keyLength: number;
  p50Ms: number;
  p95Ms: number;
  totalMs: number;
  sampleHash: string;
};

export type PasswordVerifyResult = {
  rounds: number;
  verified: number;
  failed: number;
  p50Ms: number;
  p95Ms: number;
  totalMs: number;
};

export type FileHashResult = {
  mb: number;
  chunkKb: number;
  chunks: number;
  bytes: number;
  sha256: string;
  totalMs: number;
  throughputMbSec: number;
};

export type HeavyMixedResult = {
  password: PasswordHashResult;
  verification: PasswordVerifyResult;
  file: FileHashResult;
  totalMs: number;
};

export type HashingStreamPhase = "password-hash" | "password-verify" | "file-hash" | "summary";

export type HashingStreamEvent = {
  framework: string;
  runtime: string;
  phase: HashingStreamPhase;
  current: number;
  total: number;
  progress: number;
  elapsedMs: number;
  message: string;
  sampleHash?: string;
  throughputMbSec?: number;
  sha256?: string;
};

export const capabilities = [
  "REST CRUD in-memory",
  "JWT-style HMAC auth",
  "role-aware permissions",
  "schema validation",
  "request logs",
  "rate limiting",
  "global error handling",
  "background job simulation",
  "streaming response",
  "file/content analysis",
  "password hashing and verification",
  "large payload hashing",
  "scraper simulation",
  "event loop probes",
  "micro benchmark",
] as const;

export const learningRoute = [
  "API REST completa",
  "Auth + permisos",
  "Files + streams",
  "WebSockets / streaming",
  "Colas con workers",
  "Testing",
  "Docker + deploy",
  "Microservicios",
] as const;

export function seedUsers(): User[] {
  return [
    {
      id: "usr_ada",
      name: "Ada Lovelace",
      email: "ada@example.com",
      role: "admin",
    },
    {
      id: "usr_linus",
      name: "Linus Torvalds",
      email: "linus@example.com",
      role: "operator",
    },
  ];
}

export function seedProducts(): Product[] {
  return [
    {
      id: "prd_runtime",
      name: "Runtime Deep Dive",
      price: 49,
      stock: 12,
    },
    {
      id: "prd_async",
      name: "Async Patterns Kit",
      price: 79,
      stock: 8,
    },
  ];
}

export function canAccess(actual: Role, required: Role) {
  const rank: Record<Role, number> = {
    viewer: 1,
    operator: 2,
    admin: 3,
  };

  return rank[actual] >= rank[required];
}

export function fibonacci(value: number): number {
  if (value <= 1) return value;
  return fibonacci(value - 1) + fibonacci(value - 2);
}

export function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function roundMs(value: number) {
  return Math.round(value * 100) / 100;
}

export function summarizeSamples(samples: number[], iterations: number, work: number): BenchmarkResult {
  const sorted = [...samples].sort((a, b) => a - b);

  return {
    iterations,
    work,
    minMs: roundMs(sorted[0] ?? 0),
    p50Ms: roundMs(sorted[Math.floor(sorted.length * 0.5)] ?? 0),
    p95Ms: roundMs(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    maxMs: roundMs(sorted.at(-1) ?? 0),
  };
}

export function simulatedPrices(products: Product[]) {
  return products.map((product, index) => ({
    sku: product.id,
    title: product.name,
    observedPrice: Number((product.price * (1 + index * 0.07)).toFixed(2)),
  }));
}
