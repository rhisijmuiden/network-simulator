import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { requireAdmin } from "../auth.js";
import { defaultMailSettings, getMailSettings, sendMail, type MailSettings } from "../mail.js";
import { encryptSecret } from "../secrets.js";
import { setSetting } from "../settings.js";

const MailInput = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(255),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["starttls", "tls", "none"]),
  authMethod: z.enum(["none", "login", "plain", "cram-md5"]),
  username: z.string().max(255),
  /** Empty string keeps the stored password; null clears it. */
  password: z.string().max(1000).nullable(),
  fromName: z.string().max(100),
  fromAddress: z.union([z.literal(""), z.string().email().max(255)]),
  replyTo: z.union([z.literal(""), z.string().email().max(255)]),
  minTlsVersion: z.enum(["TLSv1.2", "TLSv1.3"]),
  verifyCertificate: z.boolean(),
  dkimDomain: z.string().trim().max(255),
  dkimSelector: z.string().trim().max(63),
  dkimPrivateKey: z.string().max(10000).nullable(),
});

/** Never send stored secrets back to the browser. */
function redact(s: MailSettings) {
  return { ...s, password: "", passwordSet: s.password !== "", dkimPrivateKey: "", dkimKeySet: s.dkimPrivateKey !== "" };
}

function merge(stored: MailSettings, input: z.infer<typeof MailInput>): MailSettings {
  return {
    ...defaultMailSettings,
    ...input,
    password: input.password === null ? "" : input.password === "" ? stored.password : encryptSecret(input.password),
    dkimPrivateKey:
      input.dkimPrivateKey === null ? "" : input.dkimPrivateKey === "" ? stored.dkimPrivateKey : encryptSecret(input.dkimPrivateKey.trim()),
  };
}

export async function mailRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAdmin);

  app.get("/api/settings/mail", async () => redact(await getMailSettings()));

  app.put("/api/settings/mail", async (req) => {
    const next = merge(await getMailSettings(), MailInput.parse(req.body));
    await setSetting("mail", next);
    await audit(req.user, "settings.mailUpdated", { host: next.host, port: next.port, security: next.security }, req.ip);
    return redact(next);
  });

  /** Sends a test message with the settings in the form, before or after saving. */
  app.post("/api/settings/mail/test", async (req, reply) => {
    const body = z.object({ to: z.string().email(), settings: MailInput }).parse(req.body);
    const s = merge(await getMailSettings(), body.settings);
    try {
      await sendMail(
        {
          to: body.to,
          subject: "Network Simulator test message",
          text: "This is a test message from Network Simulator.\nYour mail server settings work.\n\nDit is een testbericht van Network Simulator. Je mailserverinstellingen werken.",
        },
        s,
      );
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ error: "mail.testFailed", detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
