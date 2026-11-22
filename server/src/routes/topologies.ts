import { emptyTopology, type Topology } from "@netsim/engine";
import { parseTopology } from "@netsim/engine/schema";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError, z } from "zod";
import { audit } from "../audit.js";
import { requireUser, type SessionUser } from "../auth.js";
import { sql } from "../db.js";

const Meta = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
});

type Row = {
  id: number;
  owner_id: number | null;
  owner: string | null;
  name: string;
  description: string;
  device_count: number;
  link_count: number;
  created_at: Date;
  updated_at: Date;
  data?: Topology;
};

const summary = (r: Row) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  owner: r.owner ?? "",
  ownerId: r.owner_id,
  deviceCount: r.device_count,
  linkCount: r.link_count,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Validates topology JSON; replies 400 with a code and returns null when it is not valid. */
function validTopology(input: unknown, reply: FastifyReply): Topology | null {
  try {
    return parseTopology(input);
  } catch (err) {
    if (err instanceof ZodError) {
      void reply.code(400).send({ error: "topology.invalid", detail: err.issues[0]?.path.join(".") });
      return null;
    }
    const code = err instanceof Error && err.message.startsWith("topology.") ? err.message : "topology.invalid";
    void reply.code(400).send({ error: code });
    return null;
  }
}

/** Admins see every topology; everyone else only their own. */
async function load(id: number, user: SessionUser, withData = false): Promise<Row | undefined> {
  const rows = await sql<Row[]>`
    SELECT t.id, t.owner_id, u.username AS owner, t.name, t.description, t.device_count, t.link_count, t.created_at, t.updated_at
      ${withData ? sql`, t.data` : sql``}
    FROM topologies t LEFT JOIN users u ON u.id = t.owner_id
    WHERE t.id = ${id} ${user.role === "admin" ? sql`` : sql`AND t.owner_id = ${user.id}`}`;
  return rows[0];
}

export async function topologyRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser());

  app.get("/api/topologies", async (req) => {
    const user = req.user!;
    const rows = await sql<Row[]>`
      SELECT t.id, t.owner_id, u.username AS owner, t.name, t.description, t.device_count, t.link_count, t.created_at, t.updated_at
      FROM topologies t LEFT JOIN users u ON u.id = t.owner_id
      ${user.role === "admin" ? sql`` : sql`WHERE t.owner_id = ${user.id}`}
      ORDER BY t.updated_at DESC`;
    return rows.map(summary);
  });

  app.get<{ Params: { id: string } }>("/api/topologies/:id", async (req, reply) => {
    const row = await load(Number(req.params.id), req.user!, true);
    if (!row) return reply.code(404).send({ error: "topology.notFound" });
    return { ...summary(row), data: row.data };
  });

  app.post("/api/topologies", async (req, reply) => {
    const body = Meta.extend({ data: z.unknown().optional() }).parse(req.body);
    const data = body.data === undefined ? emptyTopology() : validTopology(body.data, reply);
    if (!data) return reply;
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO topologies (owner_id, name, description, data, device_count, link_count)
      VALUES (${req.user!.id}, ${body.name}, ${body.description}, ${sql.json(data as never)}, ${data.devices.length}, ${data.links.length})
      RETURNING id`;
    await audit(req.user, "topologies.created", { id: row!.id, name: body.name }, req.ip);
    return { id: row!.id };
  });

  app.put<{ Params: { id: string } }>("/api/topologies/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const existing = await load(id, req.user!);
    if (!existing) return reply.code(404).send({ error: "topology.notFound" });
    const body = Meta.partial().extend({ data: z.unknown().optional() }).parse(req.body);
    const data = body.data === undefined ? undefined : validTopology(body.data, reply);
    if (data === null) return reply;
    const [row] = await sql<{ updated_at: Date }[]>`
      UPDATE topologies SET
        name = ${body.name ?? existing.name},
        description = ${body.description ?? existing.description},
        ${data ? sql`data = ${sql.json(data as never)}, device_count = ${data.devices.length}, link_count = ${data.links.length},` : sql``}
        updated_at = now()
      WHERE id = ${id}
      RETURNING updated_at`;
    return { ok: true, updatedAt: row!.updated_at };
  });

  app.post<{ Params: { id: string } }>("/api/topologies/:id/duplicate", async (req, reply) => {
    const src = await load(Number(req.params.id), req.user!, true);
    if (!src) return reply.code(404).send({ error: "topology.notFound" });
    const name = `${src.name} (copy)`.slice(0, 120);
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO topologies (owner_id, name, description, data, device_count, link_count)
      VALUES (${req.user!.id}, ${name}, ${src.description}, ${sql.json(src.data as never)}, ${src.device_count}, ${src.link_count})
      RETURNING id`;
    await audit(req.user, "topologies.duplicated", { from: src.id, id: row!.id }, req.ip);
    return { id: row!.id };
  });

  app.delete<{ Params: { id: string } }>("/api/topologies/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const existing = await load(id, req.user!);
    if (!existing) return reply.code(404).send({ error: "topology.notFound" });
    await sql`DELETE FROM topologies WHERE id = ${id}`;
    await audit(req.user, "topologies.deleted", { id, name: existing.name }, req.ip);
    return { ok: true };
  });
}
