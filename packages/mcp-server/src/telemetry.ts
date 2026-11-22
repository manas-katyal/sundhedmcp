// OpenTelemetry for hosted mode: traces, metrics and logs over OTLP/HTTP,
// each one switched on separately. Off unless SUNDHEDMCP_OTEL=1, and never in
// local (stdio) mode. The SDK is only loaded when it is on.
//
// Everything records through the global OpenTelemetry API, so with telemetry
// off every call is a no-op and tests need no setup. Instruments are made on
// first use, after startTelemetry() has set the providers.
//
// What leaves the pod: route templates (never paths with ids in them), tool
// names, record part names, sundhed.dk app names, status codes, counts and
// durations. Never health data, CPR numbers, ids from the record, tokens, or
// who is signed in. Log lines are scrubbed of long digit runs, CPR numbers,
// uuids and e-mail addresses before they leave (scrubLog).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type Attributes,
  context,
  DiagConsoleLogger,
  DiagLogLevel,
  diag,
  type Histogram,
  logs,
  metrics,
  propagation,
  SeverityNumber,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type express from "express";

export const TELEMETRY_SIGNALS = ["traces", "metrics", "logs"] as const;
export type TelemetrySignal = (typeof TELEMETRY_SIGNALS)[number];

export interface TelemetryConfig {
  /** OTLP/HTTP base URL; /v1/traces, /v1/metrics and /v1/logs are added. */
  endpoint: string;
  serviceName: string;
  serviceVersion: string;
  signals: Set<TelemetrySignal>;
  /** Share of new traces kept, 0..1. A trace started by the caller keeps the caller's choice. */
  sampleRatio: number;
  metricIntervalMs: number;
}

/** The config from the environment, or null when telemetry is off. */
export function telemetryConfig(env: NodeJS.ProcessEnv, serviceVersion: string): TelemetryConfig | null {
  if (env.SUNDHEDMCP_OTEL?.trim() !== "1") return null;
  const signals = new Set<TelemetrySignal>();
  for (const s of (env.SUNDHEDMCP_OTEL_SIGNALS ?? TELEMETRY_SIGNALS.join(",")).split(",")) {
    const name = s.trim();
    if ((TELEMETRY_SIGNALS as readonly string[]).includes(name)) signals.add(name as TelemetrySignal);
  }
  const ratio = Number(env.SUNDHEDMCP_OTEL_SAMPLE_RATIO ?? 1);
  const interval = Number(env.OTEL_METRIC_EXPORT_INTERVAL ?? 30_000);
  return {
    endpoint: (env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318").replace(/\/+$/, ""),
    serviceName: env.OTEL_SERVICE_NAME || "sundhedmcp",
    serviceVersion,
    signals,
    sampleRatio: Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1,
    metricIntervalMs: Number.isFinite(interval) && interval >= 1_000 ? interval : 30_000,
  };
}

export interface Telemetry {
  config: TelemetryConfig;
  /** Sends what is still buffered, then stops. */
  shutdown(): Promise<void>;
}

/** Sets the global providers for the switched-on signals. */
export async function startTelemetry(config: TelemetryConfig): Promise<Telemetry> {
  const [{ AsyncLocalStorageContextManager }, { W3CTraceContextPropagator }, { detectResources, resourceAttributesEnvDetector, resourceFromAttributes }] = await Promise.all([
    import("@opentelemetry/context-async-hooks"),
    import("@opentelemetry/core"),
    import("@opentelemetry/resources"),
  ]);
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  const resource = resourceFromAttributes({
    "service.name": config.serviceName,
    "service.version": config.serviceVersion,
    ...(process.env.HOSTNAME ? { "service.instance.id": process.env.HOSTNAME } : {}),
  }).merge(detectResources({ detectors: [resourceAttributesEnvDetector] }));
  const stops: Array<() => Promise<void>> = [];

  if (config.signals.has("traces")) {
    const [{ OTLPTraceExporter }, { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler, TracerProvider }] = await Promise.all([
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/sdk-trace"),
    ]);
    const provider = new TracerProvider({
      resource,
      sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(config.sampleRatio) }),
      spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces` }) })],
    });
    trace.setGlobalTracerProvider(provider);
    stops.push(() => provider.shutdown());
  }
  if (config.signals.has("metrics")) {
    const [{ OTLPMetricExporter }, { MeterProvider, PeriodicExportingMetricReader }] = await Promise.all([
      import("@opentelemetry/exporter-metrics-otlp-http"),
      import("@opentelemetry/sdk-metrics"),
    ]);
    const provider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: `${config.endpoint}/v1/metrics` }),
          exportIntervalMillis: config.metricIntervalMs,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(provider);
    stops.push(() => provider.shutdown());
  }
  if (config.signals.has("logs")) {
    const [{ OTLPLogExporter }, { BatchLogRecordProcessor, LoggerProvider }] = await Promise.all([
      import("@opentelemetry/exporter-logs-otlp-http"),
      import("@opentelemetry/sdk-logs"),
    ]);
    const provider = new LoggerProvider({
      resource,
      processors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${config.endpoint}/v1/logs` }) })],
    });
    logs.setGlobalLoggerProvider(provider);
    mirrorConsole();
    stops.push(() => provider.shutdown());
  }

  return {
    config,
    shutdown: async () => {
      await Promise.allSettled(stops.map((stop) => stop()));
    },
  };
}

// --- instruments ---

const SCOPE = "sundhedmcp";
const tracer = () => trace.getTracer(SCOPE);
const meter = () => metrics.getMeter(SCOPE);

/** Seconds, from a quick local call to a whole record fetched from sundhed.dk. */
export const SECONDS_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120];

/**
 * An instrument made on first use. The metrics API has no proxy provider, so
 * it is made again if the global provider changed since (tests).
 */
const once = <T>(make: () => T) => {
  let value: T | undefined;
  let madeFor: unknown;
  return () => {
    const provider = metrics.getMeterProvider();
    if (value === undefined || madeFor !== provider) {
      value = make();
      madeFor = provider;
    }
    return value;
  };
};

const seconds = (name: string, description: string) =>
  once((): Histogram => meter().createHistogram(name, { unit: "s", description, advice: { explicitBucketBoundaries: SECONDS_BUCKETS } }));

const httpDuration = seconds("http.server.request.duration", "HTTP requests answered by sundhedmcp, by route template.");
const toolDuration = seconds("sundhedmcp.tool.duration", "MCP tool calls, by tool and outcome.");
const fetchDuration = seconds("sundhedmcp.fetch.duration", "Fetching one part of the record from sundhed.dk into the saved copy, by part and outcome.");

const outcome = (ok: boolean) => (ok ? "ok" : "error");
const errorType = (err: unknown) => (err instanceof Error ? err.name : "Error");

// --- HTTP ---

const headerGetter = {
  get: (carrier: express.Request["headers"], key: string) => {
    const value = carrier[key];
    return Array.isArray(value) ? value[0] : value;
  },
  keys: (carrier: express.Request["headers"]) => Object.keys(carrier),
};

/**
 * The route template that answered, e.g. `/api/v1/medication-card/:id`.
 * Requests no route answered (static files, 404s, middleware that answered
 * itself) are called unmatched, so a path with an id never becomes a label.
 */
export function routeOf(req: express.Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  return typeof path === "string" ? `${req.baseUrl}${path}` || "/" : "unmatched";
}

/**
 * Express middleware: a server span per request (continuing the caller's
 * trace when it sends `traceparent`) and the request-duration histogram.
 * Health checks are counted but not traced.
 */
export function httpTelemetry(): express.RequestHandler {
  return (req, res, next) => {
    const started = performance.now();
    const method = req.method;
    const parent = propagation.extract(context.active(), req.headers, headerGetter);
    const span = req.path === "/healthz" ? undefined : tracer().startSpan(method, { kind: SpanKind.SERVER, attributes: { "http.request.method": method } }, parent);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const route = routeOf(req);
      // A request the client gave up on before the answer counts as 499.
      const status = res.writableFinished ? res.statusCode : 499;
      const attributes: Attributes = { "http.request.method": method, "http.route": route, "http.response.status_code": status };
      if (span) {
        span.updateName(`${method} ${route}`);
        span.setAttributes(attributes);
        if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
      }
      httpDuration().record((performance.now() - started) / 1000, attributes);
    };
    res.once("finish", finish);
    res.once("close", finish);
    context.with(span ? trace.setSpan(parent, span) : parent, next);
  };
}

// --- tools, fetches, gauges ---

/** Runs `run` in a span; a throw marks the span as failed and is passed on. */
export function inSpan<T>(name: string, attributes: Attributes, run: () => Promise<T>, kind: SpanKind = SpanKind.INTERNAL): Promise<T> {
  return tracer().startActiveSpan(name, { kind, attributes }, async (span) => {
    try {
      return await run();
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: errorType(err) });
      span.setAttribute("error.type", errorType(err));
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Wraps an MCP tool callback in a span and the tool-duration histogram. A result with `isError` counts as an error. */
export function instrumentTool<A extends unknown[], R>(tool: string, callback: (...args: A) => R | Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A) => {
    const started = performance.now();
    let ok = false;
    try {
      return await inSpan(`tool ${tool}`, { "mcp.tool.name": tool }, async () => {
        const result = await callback(...args);
        if ((result as { isError?: boolean } | null)?.isError === true) trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR, message: "tool error" });
        else ok = true;
        return result;
      });
    } finally {
      toolDuration().record((performance.now() - started) / 1000, { tool, outcome: outcome(ok) });
    }
  };
}

/** Makes every tool registered on `server` from now on go through instrumentTool. */
export function instrumentTools(server: McpServer): McpServer {
  const register = server.registerTool.bind(server) as (name: string, config: unknown, callback: (...args: unknown[]) => unknown) => unknown;
  server.registerTool = ((name: string, config: unknown, callback: (...args: unknown[]) => unknown) =>
    register(name, config, instrumentTool(name, callback))) as typeof server.registerTool;
  return server;
}

/** Times fetching one part of the record. `ok` says whether the part came back. */
export async function traceFetch<T>(part: string, run: () => Promise<T>, ok: (result: T) => boolean): Promise<T> {
  const started = performance.now();
  let fine = false;
  try {
    const result = await inSpan(`fetch ${part}`, { "sundhedmcp.part": part }, run);
    fine = ok(result);
    if (!fine) trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR });
    return result;
  } finally {
    fetchDuration().record((performance.now() - started) / 1000, { "sundhedmcp.part": part, outcome: outcome(fine) });
  }
}

/** Reports a gauge read when metrics are collected, e.g. the saved copies loaded. */
export function observeGauge(name: string, description: string, read: () => number): void {
  meter()
    .createObservableGauge(name, { description })
    .addCallback((result) => result.observe(read()));
}

// --- logs ---

/**
 * Takes out what could tell who someone is or what is in their record: CPR
 * numbers, uuids, e-mail addresses and runs of six or more digits (ids from
 * sundhed.dk, phone numbers).
 */
export function scrubLog(line: string): string {
  return line
    .replace(/\b\d{6}-?\d{4}\b/g, "[CPR]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi, "[email]")
    .replace(/\d{6,}/g, "[number]")
    .slice(0, 2_000);
}

let mirrored = false;

/**
 * Sends every console.log, console.warn and console.error line on as an
 * OpenTelemetry log record in the current trace, scrubbed. The console
 * output itself is left as it was.
 */
function mirrorConsole(): void {
  if (mirrored) return;
  mirrored = true;
  const levels = [
    ["log", SeverityNumber.INFO, "INFO"],
    ["info", SeverityNumber.INFO, "INFO"],
    ["warn", SeverityNumber.WARN, "WARN"],
    ["error", SeverityNumber.ERROR, "ERROR"],
  ] as const;
  for (const [method, severityNumber, severityText] of levels) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      const body = args.map((a) => (typeof a === "string" ? a : a instanceof Error ? `${a.name}: ${a.message}` : safeJson(a))).join(" ");
      logs.getLogger(SCOPE).emit({ severityNumber, severityText, body: scrubLog(body) });
    };
  }
}

const safeJson = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
