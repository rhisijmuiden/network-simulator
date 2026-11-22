import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { requireAdmin, requireUser } from "../auth.js";
import { buildInfo } from "../config.js";
import { schemaVersion } from "../db.js";
import { CHANNELS, checkForUpdates, currentChannel, requestUpdate, updateStatus } from "../updates.js";

export async function systemRoutes(app: FastifyInstance) {
  /** Shown in the Info dialog for every signed-in user. */
  app.get("/api/system/info", { preHandler: requireUser() }, async () => ({
    ...buildInfo(),
    channel: currentChannel(),
    schemaVersion: schemaVersion(),
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.post("/api/system/updates/check", { preHandler: requireAdmin }, async (req, reply) => {
    const { channel } = z.object({ channel: z.enum(CHANNELS) }).parse(req.body);
    try {
      return await checkForUpdates(channel);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/system/updates/apply", { preHandler: requireAdmin }, async (req, reply) => {
    const body = z.object({ channel: z.enum(CHANNELS), commit: z.string().regex(/^[0-9a-f]{40}$/) }).parse(req.body);
    try {
      await requestUpdate(body.channel, body.commit, req.user!.username);
      await audit(req.user, "updates.requested", body, req.ip);
      return { ok: true };
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/system/updates/status", { preHandler: requireAdmin }, async () => updateStatus());
}
