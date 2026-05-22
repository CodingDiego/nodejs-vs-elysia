import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  canAccess,
  capabilities,
  clampNumber,
  fibonacci,
  learningRoute,
  roundMs,
  seedProducts,
  seedUsers,
  simulatedPrices,
  summarizeSamples,
  type Job,
  type Product,
  type Role,
  type Sale,
  type User,
} from "@repo/lab-core";
import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

const app: Express = express();
const users: User[] = seedUsers();
const products: Product[] = seedProducts();
const sales: Sale[] = [];
const jobs: Job[] = [];
const hits = new Map<string, { count: number; resetAt: number }>();

const roleSchema = z.enum(["admin", "operator", "viewer"]);
const loginSchema = z.object({
  email: z.email(),
  role: roleSchema.default("viewer"),
});
const userSchema = z.object({
  name: z.string().min(2),
  email: z.email(),
  role: roleSchema,
});
const productSchema = z.object({
  name: z.string().min(2),
  price: z.number().positive(),
  stock: z.number().int().nonnegative(),
});
const saleSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
});
const jobSchema = z.object({
  kind: z.enum(["email", "pdf", "image", "order"]),
  payload: z.record(z.string(), z.unknown()).default({}),
});
const fileSchema = z.object({
  filename: z.string().min(1),
  content: z.string().min(1),
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);
app.use(rateLimit);

app.get("/", (_req, res) => {
  res.json({
    name: "nodejs",
    framework: "Express",
    runtime: "Node.js",
    readyForVercel: true,
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    framework: "Express",
    runtime: "Node.js",
    uptime: process.uptime(),
  });
});

app.get("/features", (_req, res) => {
  res.json({
    framework: "Express",
    runtime: "Node.js",
    capabilities,
    learningRoute,
  });
});

app.post("/auth/login", validate(loginSchema), (req, res) => {
  res.json({
    token: signToken(req.body),
    user: req.body,
  });
});

app.get("/users", requireRole("viewer"), (_req, res) => {
  res.json({ data: users });
});

app.post("/users", requireRole("admin"), validate(userSchema), (req, res) => {
  const user = { id: crypto.randomUUID(), ...req.body };
  users.push(user);
  res.status(201).json(user);
});

app.get("/products", (_req, res) => {
  res.json({ data: products });
});

app.post("/products", requireRole("operator"), validate(productSchema), (req, res) => {
  const product = { id: crypto.randomUUID(), ...req.body };
  products.push(product);
  res.status(201).json(product);
});

app.get("/sales", (_req, res) => {
  res.json({ data: sales });
});

app.post("/sales", requireRole("operator"), validate(saleSchema), (req, res) => {
  const product = products.find((item) => item.id === req.body.productId);

  if (!product) {
    res.status(404).json({ error: "not_found", message: "Product not found" });
    return;
  }

  if (product.stock < req.body.quantity) {
    res.status(409).json({ error: "stock", message: "Not enough stock" });
    return;
  }

  product.stock -= req.body.quantity;
  const sale = {
    id: crypto.randomUUID(),
    productId: product.id,
    quantity: req.body.quantity,
    total: product.price * req.body.quantity,
    createdAt: new Date().toISOString(),
  };
  sales.push(sale);
  res.status(201).json(sale);
});

app.post("/jobs", validate(jobSchema), (req, res) => {
  const job: Job = {
    id: crypto.randomUUID(),
    kind: req.body.kind,
    status: "queued",
    attempts: 0,
    createdAt: new Date().toISOString(),
  };

  jobs.push(job);
  void runJob(job);
  res.status(202).json(job);
});

app.get("/jobs", (_req, res) => {
  res.json({ data: jobs });
});

app.post("/files/analyze", validate(fileSchema), (req, res) => {
  const content = String(req.body.content);
  const buffer = Buffer.from(content);

  res.json({
    filename: req.body.filename,
    bytes: buffer.byteLength,
    lines: content.split(/\r?\n/).length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
  });
});

app.get("/scraper/prices", async (_req, res) => {
  await sleep(35);
  res.json({
    source: "simulated-market",
    capturedAt: new Date().toISOString(),
    data: simulatedPrices(products),
  });
});

app.get("/event-loop", async (req, res) => {
  const work = clampNumber(Number(req.query.work ?? 18), 5, 34);
  const microtasks = clampNumber(Number(req.query.microtasks ?? 200), 0, 5000);

  res.json({
    framework: "Express",
    runtime: "Node.js",
    ...(await eventLoopProbe(work, microtasks)),
  });
});

app.get("/benchmark", async (req, res) => {
  const iterations = clampNumber(Number(req.query.iterations ?? 40), 1, 500);
  const work = clampNumber(Number(req.query.work ?? 18), 5, 34);

  res.json({
    framework: "Express",
    runtime: "Node.js",
    ...(await benchmark(iterations, work)),
  });
});

app.get("/stream", (_req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson");
  let count = 0;
  const timer = setInterval(() => {
    count += 1;
    res.write(JSON.stringify({ framework: "Express", tick: count, at: new Date().toISOString() }) + "\n");

    if (count === 5) {
      clearInterval(timer);
      res.end();
    }
  }, 180);
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({
    error: "internal_error",
    message: "Unexpected Express API error",
  });
});

function requestLogger(req: Request, res: Response, next: NextFunction) {
  const started = performance.now();

  res.on("finish", () => {
    console.log(
      JSON.stringify({
        framework: "express",
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: roundMs(performance.now() - started),
      }),
    );
  });

  next();
}

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  const bucket = hits.get(key);

  if (!bucket || bucket.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > 120) {
    res.status(429).json({
      error: "rate_limit",
      message: "Too many requests for this demo window.",
    });
    return;
  }

  next();
}

function validate<T extends z.ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "validation", issues: parsed.error.issues });
      return;
    }

    req.body = parsed.data;
    next();
  };
}

function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const payload = token ? verifyToken(token) : null;

    if (!payload || !canAccess(payload.role, role)) {
      res.status(403).json({ error: "forbidden", message: `Requires ${role} access` });
      return;
    }

    next();
  };
}

function signToken(payload: { email: string; role: Role }) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString("base64url");
  const signature = crypto.createHmac("sha256", authSecret()).update(body).digest("base64url");

  return `${body}.${signature}`;
}

function verifyToken(token: string): { email: string; role: Role } | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = crypto.createHmac("sha256", authSecret()).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
}

function authSecret() {
  return process.env.AUTH_SECRET ?? "demo-secret-change-me";
}

async function runJob(job: Job) {
  job.status = "running";
  job.attempts += 1;
  await sleep(250 + Math.random() * 350);
  job.status = "done";
  job.finishedAt = new Date().toISOString();
}

async function eventLoopProbe(work: number, microtasks: number) {
  const started = performance.now();
  const timerPromise = new Promise<number>((resolve) => {
    const scheduledAt = performance.now();
    setTimeout(() => resolve(performance.now() - scheduledAt), 0);
  });
  const syncStarted = performance.now();
  const fibValue = fibonacci(work);
  const syncMs = performance.now() - syncStarted;

  for (let index = 0; index < microtasks; index += 1) {
    await Promise.resolve(index);
  }

  const timerDelayMs = await timerPromise;
  const asyncStarted = performance.now();
  await sleep(10);

  return {
    work,
    microtasks,
    fibValue,
    syncMs: roundMs(syncMs),
    timerDelayMs: roundMs(timerDelayMs),
    asyncWaitMs: roundMs(performance.now() - asyncStarted),
    totalMs: roundMs(performance.now() - started),
    explanation: "Synchronous CPU work blocks the timer; microtasks flush before the event loop yields.",
  };
}

async function benchmark(iterations: number, work: number) {
  const samples: number[] = [];

  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    fibonacci(work);
    samples.push(performance.now() - started);
    if (index % 10 === 0) await Promise.resolve();
  }

  return summarizeSamples(samples, iterations, work);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default app;
