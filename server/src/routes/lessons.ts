import { BUILTIN_SCENARIOS, builtinScenario, evaluateChecks, parseChecks, type Check, type CheckResult, type LessonText, type Topology } from "@netsim/engine";
import { parseTopology } from "@netsim/engine/schema";
import type { FastifyInstance, FastifyReply } from "fastify";
import { ZodError, z } from "zod";
import { audit } from "../audit.js";
import { requireUser, type SessionUser } from "../auth.js";
import { sql } from "../db.js";

/**
 * Lessons: built-in and teacher-made troubleshooting scenarios, attempts with automatic
 * checking and hints, assignments to students and progress for teachers.
 */

type Scenario = {
  key: string;
  builtin: boolean;
  level: number;
  topics: string[];
  title: LessonText;
  briefing: LessonText;
  hints: LessonText[];
  checks: Check[];
  start: () => Topology;
  ownerId?: number | null;
  owner?: string;
  published?: boolean;
};

type ScenarioRow = {
  id: number;
  owner_id: number | null;
  owner: string | null;
  title: string;
  briefing: string;
  hints: string[];
  level: number;
  data: Topology;
  checks: Check[];
  published: boolean;
  updated_at: Date;
};

type AttemptRow = {
  id: number;
  scenario_key: string;
  user_id: number;
  topology_id: number | null;
  status: "started" | "completed";
  hints_used: number;
  checks_run: number;
  last_results: CheckResult[];
  started_at: Date;
  last_checked_at: Date | null;
  completed_at: Date | null;
};

const isTeacher = (u: SessionUser) => u.role === "admin" || u.role === "instructor";
const text = (t: LessonText, lang: "en" | "nl") => (typeof t === "string" ? t : t[lang]);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function fromRow(r: ScenarioRow): Scenario {
  return {
    key: `c:${r.id}`,
    builtin: false,
    level: r.level,
    topics: [],
    title: r.title,
    briefing: r.briefing,
    hints: r.hints,
    checks: r.checks,
    start: () => clone(r.data),
    ownerId: r.owner_id,
    owner: r.owner ?? "",
    published: r.published,
  };
}

function fromBuiltin(key: string): Scenario | undefined {
  const b = builtinScenario(key);
  return b && { key: `b:${b.key}`, builtin: true, level: b.level, topics: b.topics, title: b.title, briefing: b.briefing, hints: b.hints, checks: b.checks, start: b.build };
}

const SCENARIO_SELECT = sql`
  SELECT s.id, s.owner_id, u.username AS owner, s.title, s.briefing, s.hints, s.level, s.data, s.checks, s.published, s.updated_at
  FROM scenarios s LEFT JOIN users u ON u.id = s.owner_id`;

async function assignedKeys(userId: number): Promise<Set<string>> {
  const rows = await sql<{ scenario_key: string }[]>`
    SELECT a.scenario_key FROM assignments a JOIN assignment_users au ON au.assignment_id = a.id WHERE au.user_id = ${userId}`;
  return new Set(rows.map((r) => r.scenario_key));
}

/** A scenario the user may see: built-ins for everyone, own work for teachers, published or assigned ones for students. */
async function findScenario(key: string, user: SessionUser): Promise<Scenario | undefined> {
  if (key.startsWith("b:")) return fromBuiltin(key.slice(2));
  const m = /^c:(\d+)$/.exec(key);
  if (!m) return undefined;
  const [row] = await sql<ScenarioRow[]>`${SCENARIO_SELECT} WHERE s.id = ${Number(m[1])}`;
  if (!row) return undefined;
  if (isTeacher(user) || row.published || (await assignedKeys(user.id)).has(key)) return fromRow(row);
  return undefined;
}

async function allScenarios(user: SessionUser): Promise<Scenario[]> {
  const builtins = BUILTIN_SCENARIOS.map((b) => fromBuiltin(b.key)!);
  const rows = await sql<ScenarioRow[]>`${SCENARIO_SELECT} ORDER BY s.level, s.title`;
  const assigned = isTeacher(user) ? new Set<string>() : await assignedKeys(user.id);
  const custom = rows.filter((r) => isTeacher(user) || r.published || assigned.has(`c:${r.id}`)).map(fromRow);
  return [...builtins, ...custom];
}

function attemptView(a: AttemptRow | undefined, total: number) {
  if (!a) return null;
  return {
    id: a.id,
    topologyId: a.topology_id,
    status: a.status,
    hintsUsed: a.hints_used,
    checksRun: a.checks_run,
    passed: a.last_results.filter((r) => r.passed).length,
    total,
    results: a.last_results,
    startedAt: a.started_at,
    lastCheckedAt: a.last_checked_at,
    completedAt: a.completed_at,
  };
}

/** What the client sees. Students only get the hints they asked for. */
function scenarioView(s: Scenario, user: SessionUser, attempt?: AttemptRow) {
  const revealed = isTeacher(user) ? s.hints.length : Math.min(attempt?.hints_used ?? 0, s.hints.length);
  return {
    key: s.key,
    builtin: s.builtin,
    level: s.level,
    topics: s.topics,
    title: s.title,
    briefing: s.briefing,
    hints: s.hints.slice(0, revealed),
    hintCount: s.hints.length,
    checks: s.checks,
    owner: s.owner,
    ownerId: s.ownerId,
    published: s.published,
    attempt: attemptView(attempt, s.checks.length),
  };
}

async function myAttempts(userId: number): Promise<Map<string, AttemptRow>> {
  const rows = await sql<AttemptRow[]>`SELECT * FROM attempts WHERE user_id = ${userId}`;
  return new Map(rows.map((r) => [r.scenario_key, r]));
}

async function ownAttempt(id: number, user: SessionUser): Promise<AttemptRow | undefined> {
  const [row] = await sql<AttemptRow[]>`SELECT * FROM attempts WHERE id = ${id} AND user_id = ${user.id}`;
  return row;
}

function validTopology(input: unknown, reply: FastifyReply): Topology | null {
  try {
    return parseTopology(input);
  } catch (err) {
    void reply.code(400).send({ error: err instanceof Error && err.message.startsWith("topology.") && !(err instanceof ZodError) ? err.message : "topology.invalid" });
    return null;
  }
}

const Text = z.string().trim().min(1);
const ScenarioInput = z.object({
  title: Text.max(120),
  briefing: z.string().max(4000).default(""),
  hints: z.array(Text.max(1000)).max(10).default([]),
  level: z.number().int().min(1).max(3).default(1),
  published: z.boolean().default(false),
  checks: z.unknown(),
  /** Topology to copy as the start of the scenario. */
  topologyId: z.number().int().positive().optional(),
});

const AssignmentInput = z.object({
  scenarioKey: z.string().regex(/^(b:[a-z0-9-]+|c:\d+)$/),
  /** Student ids, or empty for every student. */
  userIds: z.array(z.number().int().positive()).max(1000).default([]),
  note: z.string().max(1000).default(""),
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
});

export async function lessonRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser());
  const teacherOnly = requireUser("admin", "instructor");

  // ------------------------------------------------------------ students and teachers

  app.get("/api/lessons", async (req) => {
    const user = req.user!;
    const [list, attempts] = await Promise.all([allScenarios(user), myAttempts(user.id)]);
    const assignments = await sql<{ scenario_key: string; due_at: Date | null; note: string }[]>`
      SELECT a.scenario_key, a.due_at, a.note FROM assignments a JOIN assignment_users au ON au.assignment_id = a.id
      WHERE au.user_id = ${user.id} ORDER BY a.due_at NULLS LAST`;
    return list.map((s) => {
      const v = scenarioView(s, user, attempts.get(s.key));
      const a = assignments.find((x) => x.scenario_key === s.key);
      return { ...v, hints: [], checks: [], checkCount: s.checks.length, assignment: a ? { dueAt: a.due_at, note: a.note } : null };
    });
  });

  app.get<{ Params: { key: string } }>("/api/lessons/:key", async (req, reply) => {
    const s = await findScenario(req.params.key, req.user!);
    if (!s) return reply.code(404).send({ error: "lessons.notFound" });
    return scenarioView(s, req.user!, (await myAttempts(req.user!.id)).get(s.key));
  });

  /** Starts the scenario (a private copy of its topology) or continues the running attempt. */
  app.post<{ Params: { key: string } }>("/api/lessons/:key/start", async (req, reply) => {
    const user = req.user!;
    const s = await findScenario(req.params.key, user);
    if (!s) return reply.code(404).send({ error: "lessons.notFound" });
    const existing = (await myAttempts(user.id)).get(s.key);
    if (existing?.topology_id) {
      const [t] = await sql`SELECT id FROM topologies WHERE id = ${existing.topology_id} AND owner_id = ${user.id}`;
      if (t) return { attemptId: existing.id, topologyId: existing.topology_id };
    }
    const data = s.start();
    const name = `${text(s.title, user.language)}`.slice(0, 120);
    const [topo] = await sql<{ id: number }[]>`
      INSERT INTO topologies (owner_id, name, description, data, device_count, link_count)
      VALUES (${user.id}, ${name}, ${text(s.briefing, user.language).slice(0, 2000)}, ${sql.json(data as never)}, ${data.devices.length}, ${data.links.length})
      RETURNING id`;
    const [attempt] = await sql<{ id: number }[]>`
      INSERT INTO attempts (scenario_key, user_id, topology_id) VALUES (${s.key}, ${user.id}, ${topo!.id})
      ON CONFLICT (user_id, scenario_key) DO UPDATE SET topology_id = EXCLUDED.topology_id
      RETURNING id`;
    await audit(user, "lessons.started", { scenario: s.key }, req.ip);
    return { attemptId: attempt!.id, topologyId: topo!.id };
  });

  /** The lesson behind a topology, for the panel in the editor. */
  app.get<{ Querystring: { topology?: string } }>("/api/lessons/attempt", async (req) => {
    const user = req.user!;
    const [a] = await sql<AttemptRow[]>`SELECT * FROM attempts WHERE topology_id = ${Number(req.query.topology) || 0} AND user_id = ${user.id}`;
    if (!a) return { lesson: null };
    const s = await findScenario(a.scenario_key, user);
    return { lesson: s ? scenarioView(s, user, a) : null };
  });

  /** Saves the student's topology (when sent along) and runs the checks. */
  app.post<{ Params: { id: string } }>("/api/lessons/attempts/:id/check", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const user = req.user!;
    const a = await ownAttempt(Number(req.params.id), user);
    if (!a || !a.topology_id) return reply.code(404).send({ error: "lessons.notFound" });
    const s = await findScenario(a.scenario_key, user);
    if (!s) return reply.code(404).send({ error: "lessons.notFound" });
    const body = z.object({ data: z.unknown().optional() }).parse(req.body ?? {});
    let data: Topology | undefined;
    if (body.data !== undefined) {
      const t = validTopology(body.data, reply);
      if (!t) return reply;
      data = t;
      await sql`UPDATE topologies SET data = ${sql.json(t as never)}, device_count = ${t.devices.length}, link_count = ${t.links.length}, updated_at = now()
        WHERE id = ${a.topology_id} AND owner_id = ${user.id}`;
    } else {
      const [row] = await sql<{ data: Topology }[]>`SELECT data FROM topologies WHERE id = ${a.topology_id} AND owner_id = ${user.id}`;
      if (!row) return reply.code(404).send({ error: "lessons.notFound" });
      data = row.data;
    }
    const results = evaluateChecks(data, s.checks);
    const done = results.every((r) => r.passed);
    const [updated] = await sql<AttemptRow[]>`
      UPDATE attempts SET
        checks_run = checks_run + 1,
        last_results = ${sql.json(results as never)},
        last_checked_at = now(),
        status = ${done || a.status === "completed" ? "completed" : "started"},
        completed_at = ${done && !a.completed_at ? sql`now()` : sql`completed_at`}
      WHERE id = ${a.id} RETURNING *`;
    if (done && a.status !== "completed") await audit(user, "lessons.completed", { scenario: s.key, hints: a.hints_used }, req.ip);
    return { results, completed: done, attempt: attemptView(updated, s.checks.length) };
  });

  app.post<{ Params: { id: string } }>("/api/lessons/attempts/:id/hint", async (req, reply) => {
    const user = req.user!;
    const a = await ownAttempt(Number(req.params.id), user);
    if (!a) return reply.code(404).send({ error: "lessons.notFound" });
    const s = await findScenario(a.scenario_key, user);
    if (!s) return reply.code(404).send({ error: "lessons.notFound" });
    const used = Math.min(a.hints_used + 1, s.hints.length);
    await sql`UPDATE attempts SET hints_used = ${used} WHERE id = ${a.id}`;
    return { hints: s.hints.slice(0, used), hintCount: s.hints.length };
  });

  /** Puts the scenario's start topology back; hints already used stay counted. */
  app.post<{ Params: { id: string } }>("/api/lessons/attempts/:id/restart", async (req, reply) => {
    const user = req.user!;
    const a = await ownAttempt(Number(req.params.id), user);
    if (!a || !a.topology_id) return reply.code(404).send({ error: "lessons.notFound" });
    const s = await findScenario(a.scenario_key, user);
    if (!s) return reply.code(404).send({ error: "lessons.notFound" });
    const data = s.start();
    await sql`UPDATE topologies SET data = ${sql.json(data as never)}, device_count = ${data.devices.length}, link_count = ${data.links.length}, updated_at = now()
      WHERE id = ${a.topology_id} AND owner_id = ${user.id}`;
    await sql`UPDATE attempts SET last_results = '[]' WHERE id = ${a.id}`;
    return { ok: true };
  });

  // ------------------------------------------------------------ teachers

  app.get("/api/lessons/students", { preHandler: teacherOnly }, async () => {
    const rows = await sql<{ id: number; username: string; display_name: string }[]>`
      SELECT id, username, display_name FROM users WHERE role = 'student' AND NOT disabled ORDER BY username`;
    return rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name }));
  });

  app.get("/api/lessons/progress", { preHandler: teacherOnly }, async (req) => {
    const students = await sql<{ id: number; username: string; display_name: string }[]>`
      SELECT id, username, display_name FROM users WHERE role = 'student' ORDER BY username`;
    const attempts = await sql<AttemptRow[]>`SELECT * FROM attempts WHERE user_id IN (SELECT id FROM users WHERE role = 'student')`;
    const list = await allScenarios(req.user!);
    const totals = new Map(list.map((s) => [s.key, s.checks.length]));
    const assigned = await sql<{ scenario_key: string; user_id: number; due_at: Date | null }[]>`
      SELECT a.scenario_key, au.user_id, a.due_at FROM assignments a JOIN assignment_users au ON au.assignment_id = a.id`;
    return {
      scenarios: list.map((s) => ({ key: s.key, title: s.title, level: s.level })),
      students: students.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        attempts: attempts
          .filter((a) => a.user_id === u.id)
          .map((a) => ({ scenarioKey: a.scenario_key, ...attemptView(a, totals.get(a.scenario_key) ?? a.last_results.length)! })),
        assigned: assigned.filter((x) => x.user_id === u.id).map((x) => ({ scenarioKey: x.scenario_key, dueAt: x.due_at })),
      })),
    };
  });

  /** Copies a student's work into the teacher's own topologies, to look at or demonstrate. */
  app.post<{ Params: { id: string } }>("/api/lessons/attempts/:id/copy", { preHandler: teacherOnly }, async (req, reply) => {
    const [a] = await sql<(AttemptRow & { username: string })[]>`
      SELECT at.*, u.username FROM attempts at JOIN users u ON u.id = at.user_id WHERE at.id = ${Number(req.params.id)}`;
    const [t] = a?.topology_id ? await sql<{ name: string; data: Topology; device_count: number; link_count: number }[]>`SELECT name, data, device_count, link_count FROM topologies WHERE id = ${a.topology_id}` : [];
    if (!a || !t) return reply.code(404).send({ error: "lessons.notFound" });
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO topologies (owner_id, name, description, data, device_count, link_count)
      VALUES (${req.user!.id}, ${`${t.name} (${a.username})`.slice(0, 120)}, '', ${sql.json(t.data as never)}, ${t.device_count}, ${t.link_count})
      RETURNING id`;
    await audit(req.user, "lessons.copied", { attempt: a.id, student: a.username }, req.ip);
    return { id: row!.id };
  });

  app.get("/api/lessons/assignments", async (req) => {
    const user = req.user!;
    const rows = await sql<{ id: number; scenario_key: string; note: string; due_at: Date | null; created_at: Date; created_by: string | null; user_ids: number[] }[]>`
      SELECT a.id, a.scenario_key, a.note, a.due_at, a.created_at, u.username AS created_by,
        COALESCE(array_agg(au.user_id) FILTER (WHERE au.user_id IS NOT NULL), '{}') AS user_ids
      FROM assignments a
      LEFT JOIN users u ON u.id = a.created_by
      LEFT JOIN assignment_users au ON au.assignment_id = a.id
      ${isTeacher(user) ? sql`` : sql`WHERE a.id IN (SELECT assignment_id FROM assignment_users WHERE user_id = ${user.id})`}
      GROUP BY a.id, u.username ORDER BY a.created_at DESC`;
    return rows.map((r) => ({
      id: r.id,
      scenarioKey: r.scenario_key,
      note: r.note,
      dueAt: r.due_at,
      createdAt: r.created_at,
      createdBy: r.created_by ?? "",
      userIds: isTeacher(user) ? r.user_ids : [user.id],
    }));
  });

  app.post("/api/lessons/assignments", { preHandler: teacherOnly }, async (req, reply) => {
    const body = AssignmentInput.parse(req.body);
    if (!(await findScenario(body.scenarioKey, req.user!))) return reply.code(404).send({ error: "lessons.notFound" });
    const students = await sql<{ id: number }[]>`
      SELECT id FROM users WHERE role = 'student' AND NOT disabled ${body.userIds.length ? sql`AND id IN ${sql(body.userIds)}` : sql``}`;
    if (!students.length) return reply.code(400).send({ error: "lessons.noStudents" });
    const [a] = await sql<{ id: number }[]>`
      INSERT INTO assignments (scenario_key, created_by, note, due_at) VALUES (${body.scenarioKey}, ${req.user!.id}, ${body.note}, ${body.dueAt})
      RETURNING id`;
    await sql`INSERT INTO assignment_users ${sql(students.map((s) => ({ assignment_id: a!.id, user_id: s.id })))}`;
    await audit(req.user, "lessons.assigned", { scenario: body.scenarioKey, students: students.length }, req.ip);
    return { id: a!.id, students: students.length };
  });

  app.delete<{ Params: { id: string } }>("/api/lessons/assignments/:id", { preHandler: teacherOnly }, async (req, reply) => {
    const rows = await sql`DELETE FROM assignments WHERE id = ${Number(req.params.id)} RETURNING id`;
    if (!rows.length) return reply.code(404).send({ error: "lessons.notFound" });
    await audit(req.user, "lessons.unassigned", { id: Number(req.params.id) }, req.ip);
    return { ok: true };
  });

  // Teacher-made scenarios.

  const editable = async (id: number, user: SessionUser): Promise<ScenarioRow | undefined> => {
    const [row] = await sql<ScenarioRow[]>`${SCENARIO_SELECT} WHERE s.id = ${id}`;
    return row && (user.role === "admin" || row.owner_id === user.id) ? row : undefined;
  };

  const startTopology = async (topologyId: number, user: SessionUser): Promise<Topology | undefined> => {
    const [t] = await sql<{ data: Topology }[]>`
      SELECT data FROM topologies WHERE id = ${topologyId} ${user.role === "admin" ? sql`` : sql`AND owner_id = ${user.id}`}`;
    return t?.data;
  };

  app.get<{ Params: { id: string } }>("/api/lessons/scenarios/:id", { preHandler: teacherOnly }, async (req, reply) => {
    const [row] = await sql<ScenarioRow[]>`${SCENARIO_SELECT} WHERE s.id = ${Number(req.params.id)}`;
    if (!row) return reply.code(404).send({ error: "lessons.notFound" });
    return {
      id: row.id,
      key: `c:${row.id}`,
      title: row.title,
      briefing: row.briefing,
      hints: row.hints,
      level: row.level,
      published: row.published,
      checks: row.checks,
      data: row.data,
      owner: row.owner ?? "",
      canEdit: req.user!.role === "admin" || row.owner_id === req.user!.id,
    };
  });

  app.post("/api/lessons/scenarios", { preHandler: teacherOnly }, async (req, reply) => {
    const body = ScenarioInput.parse(req.body);
    const checks = parseChecks(body.checks);
    if (typeof checks === "string") return reply.code(400).send({ error: checks });
    if (!body.topologyId) return reply.code(400).send({ error: "lessons.noTopology" });
    const data = await startTopology(body.topologyId, req.user!);
    if (!data) return reply.code(404).send({ error: "topology.notFound" });
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO scenarios (owner_id, title, briefing, hints, level, data, checks, published)
      VALUES (${req.user!.id}, ${body.title}, ${body.briefing}, ${sql.json(body.hints)}, ${body.level}, ${sql.json(data as never)}, ${sql.json(checks as never)}, ${body.published})
      RETURNING id`;
    await audit(req.user, "lessons.scenarioCreated", { id: row!.id, title: body.title }, req.ip);
    return { id: row!.id, key: `c:${row!.id}` };
  });

  app.put<{ Params: { id: string } }>("/api/lessons/scenarios/:id", { preHandler: teacherOnly }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!(await editable(id, req.user!))) return reply.code(404).send({ error: "lessons.notFound" });
    const body = ScenarioInput.parse(req.body);
    const checks = parseChecks(body.checks);
    if (typeof checks === "string") return reply.code(400).send({ error: checks });
    const data = body.topologyId ? await startTopology(body.topologyId, req.user!) : undefined;
    if (body.topologyId && !data) return reply.code(404).send({ error: "topology.notFound" });
    await sql`
      UPDATE scenarios SET title = ${body.title}, briefing = ${body.briefing}, hints = ${sql.json(body.hints)}, level = ${body.level},
        checks = ${sql.json(checks as never)}, published = ${body.published},
        ${data ? sql`data = ${sql.json(data as never)},` : sql``}
        updated_at = now()
      WHERE id = ${id}`;
    await audit(req.user, "lessons.scenarioUpdated", { id }, req.ip);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/lessons/scenarios/:id", { preHandler: teacherOnly }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!(await editable(id, req.user!))) return reply.code(404).send({ error: "lessons.notFound" });
    await sql`DELETE FROM scenarios WHERE id = ${id}`;
    await sql`DELETE FROM assignments WHERE scenario_key = ${`c:${id}`}`;
    await audit(req.user, "lessons.scenarioDeleted", { id }, req.ip);
    return { ok: true };
  });

  /** Runs a scenario's checks against any topology, so a teacher can test them while writing. */
  app.post("/api/lessons/try-checks", { preHandler: teacherOnly }, async (req, reply) => {
    const body = z.object({ topologyId: z.number().int().positive(), checks: z.unknown() }).parse(req.body);
    const checks = parseChecks(body.checks);
    if (typeof checks === "string") return reply.code(400).send({ error: checks });
    const data = await startTopology(body.topologyId, req.user!);
    if (!data) return reply.code(404).send({ error: "topology.notFound" });
    return { results: evaluateChecks(data, checks) };
  });
}
