#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const baseUrl = (process.env.LOAD_TEST_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const path = process.env.LOAD_TEST_PATH || "/";
const method = (process.env.LOAD_TEST_METHOD || "GET").toUpperCase();
const concurrency = Math.min(Math.max(Number.parseInt(process.env.LOAD_TEST_CONCURRENCY || "25", 10), 1), 500);
const requests = Math.min(Math.max(Number.parseInt(process.env.LOAD_TEST_REQUESTS || "250", 10), concurrency), 10000);
const allowProduction = process.env.LOAD_TEST_ALLOW_PRODUCTION === "1";
const target = new URL(path, baseUrl);
if ((target.protocol === "https:") && !allowProduction && /elevoratrading\.com$/i.test(target.hostname)) {
  throw new Error("Refusing load test against production without LOAD_TEST_ALLOW_PRODUCTION=1");
}

const headers = { accept: "application/json" };
if (process.env.LOAD_TEST_BEARER_TOKEN) headers.authorization = `Bearer ${process.env.LOAD_TEST_BEARER_TOKEN}`;
if (process.env.LOAD_TEST_CONTENT_TYPE) headers["content-type"] = process.env.LOAD_TEST_CONTENT_TYPE;
const body = process.env.LOAD_TEST_BODY;
if (body && !headers["content-type"]) headers["content-type"] = "application/json";

let next = 0;
const results = [];
async function worker() {
  while (true) {
    const index = next++;
    if (index >= requests) return;
    const started = performance.now();
    try {
      const response = await fetch(target, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : body });
      await response.arrayBuffer();
      results.push({ ok: response.ok, status: response.status, ms: performance.now() - started });
    } catch (error) {
      results.push({ ok: false, status: 0, ms: performance.now() - started, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = performance.now() - started;
const successful = results.filter((r) => r.ok).length;
const statuses = Object.fromEntries([...new Set(results.map((r) => r.status))].sort((a,b) => a-b).map((status) => [String(status), results.filter((r) => r.status === status).length]));
const latencies = results.map((r) => r.ms).sort((a,b) => a-b);
const percentile = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;
console.log(JSON.stringify({
  target: target.toString(), method, concurrency, requests,
  durationMs: Math.round(elapsed), requestsPerSecond: Number((requests / (elapsed / 1000)).toFixed(2)),
  successful, failed: requests - successful, statuses,
  latencyMs: { p50: Math.round(percentile(0.50)), p95: Math.round(percentile(0.95)), p99: Math.round(percentile(0.99)), max: Math.round(latencies.at(-1) ?? 0) },
}, null, 2));
