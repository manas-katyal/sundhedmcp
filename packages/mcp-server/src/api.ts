// A JSON API at /api/v1 over the saved copy, for scripts and dashboards that
// do not speak MCP. Reads come from the copy, so they never wait on sundhed.dk.
// The calls that change something (fetch again, log out, delete the copy)
// act on this server only: nothing here writes to sundhed.dk.
// Callers authenticate like /mcp. With several people each one reaches only
// their own copy, and the changing calls need the write scope (config.ts).
import express from "express";
import { asOwner, PART_NAMES, type PartName, type SavedCopy, type Snapshot } from "./snapshot.ts";
import { syncStatus } from "./sync.ts";
import { VERSION } from "./mcp.ts";

/** What the auth step leaves in res.locals for the API. */
export interface ApiCaller {
  copy: SavedCopy;
  /** May fetch, log out and delete. */
  canWrite: boolean;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

// URL path, the snapshot key with the list, and the one with its details.
const LISTS = [
  ["medication-card", "medicationCard", "medicationDetails"],
  ["prescriptions", "prescriptions", "prescriptionDetails"],
  ["vaccinations", "vaccinations", "vaccinationDetails"],
] as const satisfies ReadonlyArray<readonly [string, PartName, keyof Snapshot]>;
const SINGLE = [
  ["summary", "summary"],
  ["lab-results", "labResults"],
  ["referrals", "referrals"],
] as const satisfies ReadonlyArray<readonly [string, PartName]>;

/** Mounts /api/v1. `auth` must set res.locals.api (an ApiCaller) or answer itself. */
export function mountApi(app: express.Express, opts: { auth: express.RequestHandler; writeScope: string; log: (msg: string) => void }): void {
  const router = express.Router();
  app.use("/api/v1", router);

  router.get("/openapi.json", (_req, res) => void res.json(openApi(opts.writeScope)));

  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(opts.auth);
  const callerOf = (res: express.Response) => res.locals.api as ApiCaller;
  const run = (handler: (req: express.Request, res: express.Response, copy: SavedCopy) => Promise<void> | void): express.RequestHandler => {
    return (req, res) => {
      const { copy } = callerOf(res);
      Promise.resolve(asOwner(copy, () => handler(req, res, copy))).catch((err: unknown) => {
        opts.log(`api request failed: ${(err as Error).message}`);
        if (!res.headersSent) res.status(500).json({ error: "internal_error" });
      });
    };
  };
  const requireWrite: express.RequestHandler = (_req, res, next) => {
    if (callerOf(res).canWrite) return next();
    res
      .status(403)
      .set("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${opts.writeScope}"`)
      .json({ error: "insufficient_scope", error_description: `This needs the ${opts.writeScope} scope.` });
  };
  const notFetched = (res: express.Response, part: PartName, snap: Snapshot | null) =>
    void res.status(404).json({ error: "not_fetched", error_description: snap?.errors[part] ?? "This part has not been fetched yet. Log in at /connect." });
  const part = (snap: Snapshot, name: PartName) => ({ fetchedAt: snap.fetchedAt[name] ?? null, error: snap.errors[name] ?? null, data: snap[name] });

  router.get(
    "/status",
    run(async (_req, res, copy) => {
      const snap = copy.saved();
      const s = await copy.session.status().catch(() => ({ loggedIn: false }));
      res.json({
        version: VERSION,
        loggedIn: s.loggedIn,
        refreshing: copy.isRunning(),
        savedAt: snap?.savedAt ?? null,
        fetchedAt: snap?.fetchedAt ?? {},
        errors: snap?.errors ?? {},
        sync: syncStatus(),
      });
    }),
  );

  for (const [path, name] of SINGLE) {
    router.get(
      `/${path}`,
      run((_req, res, copy) => {
        const snap = copy.saved();
        if (!snap || snap[name] === undefined) return notFetched(res, name, snap);
        res.json(part(snap, name));
      }),
    );
  }

  for (const [path, name, details] of LISTS) {
    router.get(
      `/${path}`,
      run((_req, res, copy) => {
        const snap = copy.saved();
        if (!snap || snap[name] === undefined) return notFetched(res, name, snap);
        res.json({ ...part(snap, name), details: Object.keys(snap[details] as Record<string, unknown>) });
      }),
    );
    router.get(
      `/${path}/:id`,
      run((req, res, copy) => {
        const id = String(req.params.id);
        if (!ID.test(id)) return void res.status(400).json({ error: "invalid_id" });
        const found = (copy.saved()?.[details] as Record<string, unknown> | undefined)?.[id];
        if (found === undefined) return void res.status(404).json({ error: "not_found" });
        res.json({ id, data: found });
      }),
    );
  }

  router.post(
    "/refresh",
    requireWrite,
    express.json({ limit: "4kb" }),
    run(async (req, res, copy) => {
      const asked = (req.body as { parts?: unknown } | undefined)?.parts;
      if (asked !== undefined && (!Array.isArray(asked) || asked.length === 0 || !asked.every((p) => PART_NAMES.includes(p)))) {
        return void res.status(400).json({ error: "invalid_parts", error_description: `parts must be a list of: ${PART_NAMES.join(", ")}` });
      }
      const s = await copy.session.status().catch(() => ({ loggedIn: false }));
      if (!s.loggedIn) return void res.status(409).json({ error: "not_logged_in", error_description: "Log in with MitID at /connect first." });
      const parts = (asked as PartName[] | undefined) ?? [...PART_NAMES];
      // Answers at once; GET /status shows when it is done.
      copy.refresh(parts).catch((err: unknown) => opts.log(`api refresh failed: ${(err as Error).message}`));
      res.status(202).json({ refreshing: true, parts });
    }),
  );

  router.post(
    "/logout",
    requireWrite,
    express.json({ limit: "4kb" }),
    run(async (req, res, copy) => {
      const forgetCopy = (req.body as { forgetSavedCopy?: unknown } | undefined)?.forgetSavedCopy === true;
      await copy.session.disconnect();
      if (forgetCopy) await copy.forget();
      res.json({ loggedIn: false, savedCopyDeleted: forgetCopy });
    }),
  );

  router.delete(
    "/saved-copy",
    requireWrite,
    run(async (_req, res, copy) => {
      await copy.forget();
      res.status(204).end();
    }),
  );

  router.use((_req, res) => void res.status(404).json({ error: "not_found" }));
}

/** A short OpenAPI 3.1 description of the API. */
export function openApi(writeScope: string) {
  const ok = (description: string) => ({ description, content: { "application/json": { schema: { type: "object" } } } });
  const read = (summary: string) => ({ get: { summary, security: [{ bearer: [] }], responses: { 200: ok("The saved part, when it was fetched, and the last error."), 404: ok("Not fetched yet.") } } });
  const write = (method: "post" | "delete", summary: string, body?: Record<string, unknown>) => ({
    [method]: {
      summary,
      security: [{ bearer: writeScope ? [writeScope] : [] }],
      ...(body ? { requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: body } } } } } : {}),
      responses: { 200: ok("Done."), 202: ok("Started."), 204: { description: "Done." }, 403: ok(`Needs the ${writeScope || "write"} scope.`), 409: ok("Not logged in.") },
    },
  });
  const detail = (summary: string) => ({
    get: { summary, security: [{ bearer: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: ID.source } }], responses: { 200: ok("The detail."), 404: ok("No such id.") } },
  });
  return {
    openapi: "3.1.0",
    info: { title: "SundhedMCP API", version: VERSION, description: "The saved copy of your sundhed.dk record. Nothing here writes to sundhed.dk." },
    servers: [{ url: "/api/v1" }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    paths: {
      "/status": read("Login, sync and refresh status, and when each part was fetched."),
      "/summary": read("The overview."),
      "/medication-card": read("The medication card, with the ids that have details."),
      "/medication-card/{id}": detail("One medicine on the card."),
      "/prescriptions": read("Prescriptions, with the ids that have details."),
      "/prescriptions/{id}": detail("One prescription."),
      "/vaccinations": read("Vaccinations, with the ids that have details."),
      "/vaccinations/{id}": detail("One vaccination."),
      "/lab-results": read("Lab results of the last years."),
      "/referrals": read("Referrals."),
      "/refresh": write("post", "Fetch the record (or some parts) from sundhed.dk again, in the background.", { parts: { type: "array", items: { enum: [...PART_NAMES] } } }),
      "/logout": write("post", "Close the browser and end the sundhed.dk session.", { forgetSavedCopy: { type: "boolean" } }),
      "/saved-copy": write("delete", "Delete the saved copy."),
    },
  };
}
