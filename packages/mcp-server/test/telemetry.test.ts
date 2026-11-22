import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { context, metrics, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import express from "express";
import { httpTelemetry, instrumentTool, scrubLog, telemetryConfig, traceFetch } from "../src/telemetry.ts";

const spans = new InMemorySpanExporter();
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({ exporter: metricExporter, exportIntervalMillis: 60_000 });

let server: Server;
let base = "";

before(async () => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spans })] }));
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));

  const app = express();
  app.use(httpTelemetry());
  const router = express.Router();
  router.get("/medication-card/:id", (req, res) => void res.json({ id: req.params.id }));
  app.use("/api/v1", router);
  app.get("/healthz", (_req, res) => void res.json({ ok: true }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(() => {
  server.close();
  trace.disable();
  metrics.disable();
  propagation.disable();
  context.disable();
});

async function points(name: string) {
  await reader.forceFlush();
  return metricExporter
    .getMetrics()
    .flatMap((r) => r.scopeMetrics.flatMap((s) => s.metrics))
    .filter((m) => m.descriptor.name === name)
    .flatMap((m) => m.dataPoints.map((p) => p.attributes));
}

// Waits for the span of a request: it ends on the response's finish event, which may come after fetch resolves.
const settle = () => new Promise((r) => setTimeout(r, 20));

test("telemetry is off unless asked for", () => {
  assert.equal(telemetryConfig({}, "1.0.0"), null);
  const config = telemetryConfig({ SUNDHEDMCP_OTEL: "1", SUNDHEDMCP_OTEL_SIGNALS: "traces, metrics,nope", SUNDHEDMCP_OTEL_SAMPLE_RATIO: "7", OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318/" }, "1.0.0");
  assert.deepEqual([...(config?.signals ?? [])], ["traces", "metrics"]);
  assert.equal(config?.sampleRatio, 1);
  assert.equal(config?.endpoint, "http://collector:4318");
  assert.equal(config?.serviceName, "sundhedmcp");
});

test("requests are named by route template, never by the id in the path", async () => {
  spans.reset();
  await (await fetch(`${base}/api/v1/medication-card/ord-123456789`)).text();
  await (await fetch(`${base}/no/such/0101011234`)).text();
  await (await fetch(`${base}/healthz`)).text();
  await settle();

  const names = spans.getFinishedSpans().map((s) => s.name);
  assert.deepEqual(names, ["GET /api/v1/medication-card/:id", "GET unmatched"]);
  const attributes = await points("http.server.request.duration");
  assert.ok(attributes.some((a) => a["http.route"] === "/api/v1/medication-card/:id" && a["http.response.status_code"] === 200));
  assert.ok(attributes.some((a) => a["http.route"] === "unmatched" && a["http.response.status_code"] === 404));
  assert.ok(attributes.some((a) => a["http.route"] === "/healthz"));
  const sent = JSON.stringify([attributes, spans.getFinishedSpans().map((s) => [s.name, s.attributes])]);
  assert.ok(!sent.includes("123456789"));
  assert.ok(!sent.includes("0101011234"));
});

test("the caller's trace is continued", async () => {
  spans.reset();
  const traceId = "0af7651916cd43dd8448eb211c80319c";
  await (await fetch(`${base}/api/v1/medication-card/x`, { headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01` } })).text();
  await settle();
  assert.equal(spans.getFinishedSpans()[0]?.spanContext().traceId, traceId);
});

test("tool calls and fetches count a failure as an error", async () => {
  spans.reset();
  const ok = instrumentTool("get_summary", async () => ({ content: [] }));
  const failing = instrumentTool("get_referrals", async () => ({ content: [], isError: true }));
  await ok();
  await failing();
  await traceFetch("labResults", async () => undefined, (r) => r !== undefined);
  await assert.rejects(traceFetch("summary", async () => Promise.reject(new TypeError("boom")), () => true));

  const tools = await points("sundhedmcp.tool.duration");
  assert.ok(tools.some((a) => a.tool === "get_summary" && a.outcome === "ok"));
  assert.ok(tools.some((a) => a.tool === "get_referrals" && a.outcome === "error"));
  const fetches = await points("sundhedmcp.fetch.duration");
  assert.ok(fetches.some((a) => a["sundhedmcp.part"] === "labResults" && a.outcome === "error"));
  assert.ok(fetches.some((a) => a["sundhedmcp.part"] === "summary" && a.outcome === "error"));
  assert.equal(spans.getFinishedSpans().find((s) => s.name === "fetch summary")?.attributes["error.type"], "TypeError");
});

test("log lines lose what could identify a person", () => {
  assert.equal(
    scrubLog("user 0101011234 (010101-1234) mail test@example.test id 2f1c9a3e-1b2c-4d5e-8f90-123456789abc ord 9876543 ok 2025"),
    "user [CPR] ([CPR]) mail [email] id [id] ord [number] ok 2025",
  );
});
