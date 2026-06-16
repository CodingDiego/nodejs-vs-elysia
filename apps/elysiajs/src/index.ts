import crypto from "node:crypto";
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
  type FileHashResult,
  type HashingStreamEvent,
  type HeavyMixedResult,
  type Job,
  type PasswordHashResult,
  type PasswordVerifyResult,
  type Product,
  type Role,
  type Sale,
  type User,
} from "@repo/lab-core";
import { Elysia, status, t } from "elysia";

const users: User[] = seedUsers();
const products: Product[] = seedProducts();
const sales: Sale[] = [];
const jobs: Job[] = [];
const hits = new Map<string, { count: number; resetAt: number }>();

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};
const roleModel = t.Union([t.Literal("admin"), t.Literal("operator"), t.Literal("viewer")]);

const app = new Elysia()
  .model({
    login: t.Object({
      email: t.String({ format: "email" }),
      role: t.Optional(roleModel),
    }),
    userCreate: t.Object({
      name: t.String({ minLength: 2 }),
      email: t.String({ format: "email" }),
      role: roleModel,
    }),
    productCreate: t.Object({
      name: t.String({ minLength: 2 }),
      price: t.Number({ minimum: 0.01 }),
      stock: t.Integer({ minimum: 0 }),
    }),
    saleCreate: t.Object({
      productId: t.String({ minLength: 1 }),
      quantity: t.Integer({ minimum: 1 }),
    }),
    jobCreate: t.Object({
      kind: t.Union([t.Literal("email"), t.Literal("pdf"), t.Literal("image"), t.Literal("order")]),
      payload: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
    fileAnalyze: t.Object({
      filename: t.String({ minLength: 1 }),
      content: t.String({ minLength: 1 }),
    }),
    passwordWork: t.Object({
      rounds: t.Optional(t.Integer({ minimum: 1, maximum: 60, default: 8 })),
      passwordLength: t.Optional(t.Integer({ minimum: 8, maximum: 4096, default: 64 })),
      keyLength: t.Optional(t.Integer({ minimum: 16, maximum: 128, default: 64 })),
    }),
    fileHashWork: t.Object({
      mb: t.Optional(t.Integer({ minimum: 1, maximum: 96, default: 8 })),
      chunkKb: t.Optional(t.Integer({ minimum: 16, maximum: 1024, default: 256 })),
    }),
    heavyMixed: t.Object({
      rounds: t.Optional(t.Integer({ minimum: 1, maximum: 40, default: 6 })),
      passwordLength: t.Optional(t.Integer({ minimum: 8, maximum: 4096, default: 64 })),
      mb: t.Optional(t.Integer({ minimum: 1, maximum: 96, default: 8 })),
    }),
    hashingStreamQuery: t.Object({
      rounds: t.Optional(t.String()),
      passwordLength: t.Optional(t.String()),
      keyLength: t.Optional(t.String()),
      fileMb: t.Optional(t.String()),
      chunkKb: t.Optional(t.String()),
    }),
  })
  .onRequest(({ request, set }) => {
    Object.assign(set.headers, corsHeaders);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const key = request.headers.get("x-forwarded-for") ?? "local";
    const now = Date.now();
    const bucket = hits.get(key);

    if (!bucket || bucket.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }

    bucket.count += 1;
    if (bucket.count > 120) {
      return status(429, { error: "rate_limit", message: "Too many requests for this demo window." });
    }
  })
  .onAfterResponse(({ request, set }) => {
    console.log(
      JSON.stringify({
        framework: "elysia",
        method: request.method,
        path: new URL(request.url).pathname,
        status: set.status ?? 200,
      }),
    );
  })
  .onError(({ code, error }) => {
    if (code === "VALIDATION") {
      return status(400, { error: "validation", message: error.message });
    }

    console.error(error);
    return status(500, {
      error: "internal_error",
      message: "Unexpected Elysia API error",
    });
  })
  .get("/", () => ({
    name: "elysiajs",
    framework: "Elysia",
    runtime: "Bun",
    readyForVercel: true,
  }))
  .get("/health", () => ({
    ok: true,
    framework: "Elysia",
    runtime: "Bun",
    uptime: performance.now() / 1000,
  }))
  .get("/features", () => ({
    framework: "Elysia",
    runtime: "Bun",
    capabilities,
    learningRoute,
  }))
  .post(
    "/auth/login",
    ({ body }) => {
      const role = body.role ?? "viewer";
      return {
        token: signToken({ email: body.email, role }),
        user: { email: body.email, role },
      };
    },
    {
      body: "login",
    },
  )
  .get("/users", ({ request }) => {
    const denied = requireRole(request, "viewer");
    if (denied) return denied;

    return { data: users };
  })
  .post(
    "/users",
    ({ request, body }) => {
      const denied = requireRole(request, "admin");
      if (denied) return denied;

      const user = { id: crypto.randomUUID(), ...body };
      users.push(user);
      return status(201, user);
    },
    {
      body: "userCreate",
    },
  )
  .get("/products", () => ({ data: products }))
  .post(
    "/products",
    ({ request, body }) => {
      const denied = requireRole(request, "operator");
      if (denied) return denied;

      const product = { id: crypto.randomUUID(), ...body };
      products.push(product);
      return status(201, product);
    },
    {
      body: "productCreate",
    },
  )
  .get("/sales", () => ({ data: sales }))
  .post(
    "/sales",
    ({ request, body }) => {
      const denied = requireRole(request, "operator");
      if (denied) return denied;

      const product = products.find((item) => item.id === body.productId);
      if (!product) return status(404, { error: "not_found", message: "Product not found" });
      if (product.stock < body.quantity) return status(409, { error: "stock", message: "Not enough stock" });

      product.stock -= body.quantity;
      const sale = {
        id: crypto.randomUUID(),
        productId: product.id,
        quantity: body.quantity,
        total: product.price * body.quantity,
        createdAt: new Date().toISOString(),
      };
      sales.push(sale);
      return status(201, sale);
    },
    {
      body: "saleCreate",
    },
  )
  .post(
    "/jobs",
    ({ body }) => {
      const job: Job = {
        id: crypto.randomUUID(),
        kind: body.kind,
        status: "queued",
        attempts: 0,
        createdAt: new Date().toISOString(),
      };

      jobs.push(job);
      void runJob(job);
      return status(202, job);
    },
    {
      body: "jobCreate",
    },
  )
  .get("/jobs", () => ({ data: jobs }))
  .post(
    "/files/analyze",
    ({ body }) => {
      const buffer = Buffer.from(body.content);

      return {
        filename: body.filename,
        bytes: buffer.byteLength,
        lines: body.content.split(/\r?\n/).length,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      };
    },
    {
      body: "fileAnalyze",
    },
  )
  .post(
    "/heavy/password-hash",
    async ({ body }) => {
      const result = await passwordHashWork(body.rounds ?? 8, body.passwordLength ?? 64, body.keyLength ?? 64);
      return { framework: "Elysia", runtime: "Bun", ...result };
    },
    {
      body: "passwordWork",
    },
  )
  .post(
    "/heavy/password-verify",
    async ({ body }) => {
      const result = await passwordVerifyWork(body.rounds ?? 8, body.passwordLength ?? 64, body.keyLength ?? 64);
      return { framework: "Elysia", runtime: "Bun", ...result };
    },
    {
      body: "passwordWork",
    },
  )
  .post(
    "/heavy/file-hash",
    ({ body }) => {
      const result = fileHashWork(body.mb ?? 8, body.chunkKb ?? 256);
      return { framework: "Elysia", runtime: "Bun", ...result };
    },
    {
      body: "fileHashWork",
    },
  )
  .post(
    "/heavy/mixed",
    async ({ body }) => {
      const rounds = body.rounds ?? 6;
      const passwordLength = body.passwordLength ?? 64;
      const mb = body.mb ?? 8;
      const started = performance.now();
      const password = await passwordHashWork(rounds, passwordLength, 64);
      const verification = await passwordVerifyWork(rounds, passwordLength, 64);
      const file = fileHashWork(mb, 256);
      const result: HeavyMixedResult = {
        password,
        verification,
        file,
        totalMs: roundMs(performance.now() - started),
      };

      return { framework: "Elysia", runtime: "Bun", ...result };
    },
    {
      body: "heavyMixed",
    },
  )
  .get("/scraper/prices", async () => {
    await sleep(35);

    return {
      source: "simulated-market",
      capturedAt: new Date().toISOString(),
      data: simulatedPrices(products),
    };
  })
  .get(
    "/event-loop",
    async ({ query }) => {
      const work = clampNumber(Number(query.work ?? 18), 5, 34);
      const microtasks = clampNumber(Number(query.microtasks ?? 200), 0, 5000);

      return {
        framework: "Elysia",
        runtime: "Bun",
        ...(await eventLoopProbe(work, microtasks)),
      };
    },
    {
      query: t.Object({
        work: t.Optional(t.String()),
        microtasks: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/benchmark",
    async ({ query }) => {
      const iterations = clampNumber(Number(query.iterations ?? 40), 1, 500);
      const work = clampNumber(Number(query.work ?? 18), 5, 34);

      return {
        framework: "Elysia",
        runtime: "Bun",
        ...(await benchmark(iterations, work)),
      };
    },
    {
      query: t.Object({
        iterations: t.Optional(t.String()),
        work: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/heavy/hashing-stream",
    ({ query }) => {
      const rounds = clampNumber(Number(query.rounds ?? 8), 1, 60);
      const passwordLength = clampNumber(Number(query.passwordLength ?? 128), 8, 4096);
      const keyLength = clampNumber(Number(query.keyLength ?? 64), 16, 128);
      const fileMb = clampNumber(Number(query.fileMb ?? 16), 1, 128);
      const chunkKb = clampNumber(Number(query.chunkKb ?? 256), 16, 1024);
      const started = performance.now();
      const encoder = new TextEncoder();

      return new Response(
        new ReadableStream({
          start(controller) {
            const send = (event: Omit<HashingStreamEvent, "framework" | "runtime">) => {
              const payload: HashingStreamEvent = {
                framework: "Elysia",
                runtime: "Bun",
                ...event,
              };
              controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
            };

            void streamHashingWork({ rounds, passwordLength, keyLength, fileMb, chunkKb, started, send })
              .then(() => controller.close())
              .catch((error: unknown) => controller.error(error));
          },
        }),
        {
          headers: {
            "content-type": "application/x-ndjson",
            "cache-control": "no-cache, no-transform",
            ...corsHeaders,
          },
        },
      );
    },
    {
      query: "hashingStreamQuery",
    },
  )
  .get("/stream", () => {
    const encoder = new TextEncoder();

    return new Response(
      new ReadableStream({
        start(controller) {
          let count = 0;
          const timer = setInterval(() => {
            count += 1;
            controller.enqueue(
              encoder.encode(JSON.stringify({ framework: "Elysia", tick: count, at: new Date().toISOString() }) + "\n"),
            );

            if (count === 5) {
              clearInterval(timer);
              controller.close();
            }
          }, 180);
        },
      }),
      {
        headers: { "content-type": "application/x-ndjson", ...corsHeaders },
      },
    );
  });

function requireRole(request: Request, role: Role) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const payload = token ? verifyToken(token) : null;

  if (!payload || !canAccess(payload.role, role)) {
    return status(403, { error: "forbidden", message: `Requires ${role} access` });
  }

  return null;
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
  return Bun.env.AUTH_SECRET ?? "demo-secret-change-me";
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

async function passwordHashWork(rounds: number, passwordLength: number, keyLength: number): Promise<PasswordHashResult> {
  const samples: number[] = [];
  let sampleHash = "";
  const totalStarted = performance.now();

  for (let index = 0; index < rounds; index += 1) {
    const password = deterministicPassword(index, passwordLength);
    const salt = `node-vs-elysia-salt-${index}`;
    const started = performance.now();
    const hash = await scrypt(password, salt, keyLength);
    samples.push(performance.now() - started);
    if (index === 0) sampleHash = hash.toString("hex");
  }

  const summary = summarizeSamples(samples, rounds, 0);

  return {
    rounds,
    passwordBytes: Buffer.byteLength(deterministicPassword(0, passwordLength)),
    keyLength,
    p50Ms: summary.p50Ms,
    p95Ms: summary.p95Ms,
    totalMs: roundMs(performance.now() - totalStarted),
    sampleHash,
  };
}

async function passwordVerifyWork(rounds: number, passwordLength: number, keyLength: number): Promise<PasswordVerifyResult> {
  const hashes: Buffer[] = [];
  const samples: number[] = [];
  let verified = 0;
  let failed = 0;
  const totalStarted = performance.now();

  for (let index = 0; index < rounds; index += 1) {
    hashes.push(await scrypt(deterministicPassword(index, passwordLength), `node-vs-elysia-salt-${index}`, keyLength));
  }

  for (let index = 0; index < rounds; index += 1) {
    const started = performance.now();
    const candidate = await scrypt(deterministicPassword(index, passwordLength), `node-vs-elysia-salt-${index}`, keyLength);
    samples.push(performance.now() - started);
    if (crypto.timingSafeEqual(candidate, hashes[index]!)) verified += 1;
    else failed += 1;
  }

  const summary = summarizeSamples(samples, rounds, 0);

  return {
    rounds,
    verified,
    failed,
    p50Ms: summary.p50Ms,
    p95Ms: summary.p95Ms,
    totalMs: roundMs(performance.now() - totalStarted),
  };
}

function fileHashWork(mb: number, chunkKb: number): FileHashResult {
  const started = performance.now();
  const hash = crypto.createHash("sha256");
  const chunkBytes = chunkKb * 1024;
  const totalBytes = mb * 1024 * 1024;
  const chunk = Buffer.allocUnsafe(chunkBytes);
  let written = 0;
  let chunks = 0;

  while (written < totalBytes) {
    const size = Math.min(chunkBytes, totalBytes - written);
    for (let index = 0; index < size; index += 1) {
      chunk[index] = (written + index) % 251;
    }
    hash.update(size === chunkBytes ? chunk : chunk.subarray(0, size));
    written += size;
    chunks += 1;
  }

  const totalMs = roundMs(performance.now() - started);

  return {
    mb,
    chunkKb,
    chunks,
    bytes: totalBytes,
    sha256: hash.digest("hex"),
    totalMs,
    throughputMbSec: roundMs(mb / Math.max(totalMs / 1000, 0.001)),
  };
}

async function streamHashingWork({
  rounds,
  passwordLength,
  keyLength,
  fileMb,
  chunkKb,
  started,
  send,
}: {
  rounds: number;
  passwordLength: number;
  keyLength: number;
  fileMb: number;
  chunkKb: number;
  started: number;
  send: (event: Omit<HashingStreamEvent, "framework" | "runtime">) => void;
}) {
  const hashes: Buffer[] = [];
  const totalSteps = rounds * 2 + Math.ceil((fileMb * 1024) / chunkKb);
  let completed = 0;
  let sampleHash = "";

  const publish = (
    phase: HashingStreamEvent["phase"],
    current: number,
    total: number,
    message: string,
    extras: Partial<HashingStreamEvent> = {},
  ) => {
    send({
      phase,
      current,
      total,
      progress: Math.round((completed / totalSteps) * 100),
      elapsedMs: roundMs(performance.now() - started),
      message,
      ...extras,
    });
  };

  for (let index = 0; index < rounds; index += 1) {
    const hash = await scrypt(deterministicPassword(index, passwordLength), `node-vs-elysia-salt-${index}`, keyLength);
    hashes.push(hash);
    if (index === 0) sampleHash = hash.toString("hex");
    completed += 1;
    publish("password-hash", index + 1, rounds, `Derived password key ${index + 1}/${rounds}`, {
      sampleHash: sampleHash.slice(0, 24),
    });
  }

  let verified = 0;
  for (let index = 0; index < rounds; index += 1) {
    const candidate = await scrypt(deterministicPassword(index, passwordLength), `node-vs-elysia-salt-${index}`, keyLength);
    if (crypto.timingSafeEqual(candidate, hashes[index]!)) verified += 1;
    completed += 1;
    publish("password-verify", index + 1, rounds, `Verified password ${verified}/${rounds}`);
  }

  const hashStarted = performance.now();
  const digest = crypto.createHash("sha256");
  const chunkBytes = chunkKb * 1024;
  const totalBytes = fileMb * 1024 * 1024;
  const totalChunks = Math.ceil(totalBytes / chunkBytes);
  const chunk = Buffer.allocUnsafe(chunkBytes);
  let written = 0;
  let chunks = 0;

  while (written < totalBytes) {
    const size = Math.min(chunkBytes, totalBytes - written);
    for (let index = 0; index < size; index += 1) {
      chunk[index] = (written + index) % 251;
    }
    digest.update(size === chunkBytes ? chunk : chunk.subarray(0, size));
    written += size;
    chunks += 1;
    completed += 1;

    const fileElapsed = performance.now() - hashStarted;
    publish("file-hash", chunks, totalChunks, `Hashed ${Math.round(written / 1024 / 1024)}MB/${fileMb}MB`, {
      throughputMbSec: roundMs(written / 1024 / 1024 / Math.max(fileElapsed / 1000, 0.001)),
    });

    if (chunks % 2 === 0) await sleep(0);
  }

  publish("summary", totalSteps, totalSteps, `Hashing benchmark complete: ${roundMs(performance.now() - started)} ms`, {
    progress: 100,
    sha256: digest.digest("hex"),
  });
}

function deterministicPassword(index: number, length: number) {
  const seed = `correct-horse-battery-staple-${index}-`;
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
}

function scrypt(password: string, salt: string, keyLength: number) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, { N: 16_384, r: 8, p: 1 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default app;
