import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { decryptSecret } from "./secrets.js";
import { getSetting } from "./settings.js";
import { sql } from "./db.js";

export type MailSettings = {
  enabled: boolean;
  host: string;
  port: number;
  /** starttls: plain connect then mandatory STARTTLS (587). tls: implicit TLS (465). none: no encryption. */
  security: "starttls" | "tls" | "none";
  authMethod: "none" | "login" | "plain" | "cram-md5";
  username: string;
  /** Encrypted with the secret key. */
  password: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  minTlsVersion: "TLSv1.2" | "TLSv1.3";
  verifyCertificate: boolean;
  /** Optional DKIM signing. privateKey is encrypted. */
  dkimDomain: string;
  dkimSelector: string;
  dkimPrivateKey: string;
};

export const defaultMailSettings: MailSettings = {
  enabled: false,
  host: "",
  port: 587,
  security: "starttls",
  authMethod: "login",
  username: "",
  password: "",
  fromName: "Network Simulator",
  fromAddress: "",
  replyTo: "",
  minTlsVersion: "TLSv1.2",
  verifyCertificate: true,
  dkimDomain: "",
  dkimSelector: "",
  dkimPrivateKey: "",
};

export function getMailSettings(): Promise<MailSettings> {
  return getSetting("mail", defaultMailSettings);
}

export function createTransport(s: MailSettings) {
  const options: SMTPTransport.Options = {
    host: s.host,
    port: s.port,
    secure: s.security === "tls",
    requireTLS: s.security === "starttls",
    ignoreTLS: s.security === "none",
    name: undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    tls: {
      minVersion: s.minTlsVersion,
      rejectUnauthorized: s.verifyCertificate,
      servername: s.host,
    },
  };
  if (s.authMethod !== "none") {
    options.auth = { user: s.username, pass: decryptSecret(s.password) };
    options.authMethod = s.authMethod.toUpperCase();
  }
  if (s.dkimDomain && s.dkimSelector && s.dkimPrivateKey) {
    options.dkim = { domainName: s.dkimDomain, keySelector: s.dkimSelector, privateKey: decryptSecret(s.dkimPrivateKey) };
  }
  return nodemailer.createTransport(options);
}

export type Mail = { to: string | string[]; subject: string; text: string; html?: string };

export async function sendMail(mail: Mail, settings?: MailSettings): Promise<void> {
  const s = settings ?? (await getMailSettings());
  if (!s.enabled && !settings) throw new Error("mail.notConfigured");
  if (!s.host || !s.fromAddress) throw new Error("mail.notConfigured");
  const transport = createTransport(s);
  try {
    await transport.sendMail({
      from: { name: s.fromName, address: s.fromAddress },
      replyTo: s.replyTo || undefined,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html ?? brandedHtml(mail.subject, mail.text),
    });
  } finally {
    transport.close();
  }
}

/** Sends to every enabled administrator with an e-mail address. Never throws. */
export async function notifyAdmins(subject: string, text: string): Promise<void> {
  try {
    const s = await getMailSettings();
    if (!s.enabled) return;
    const rows = await sql<{ email: string }[]>`SELECT email FROM users WHERE role = 'admin' AND NOT disabled AND email <> ''`;
    if (rows.length) await sendMail({ to: rows.map((r) => r.email), subject, text }, s);
  } catch (err) {
    console.error("notifyAdmins failed:", err);
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Simple RHIS-styled HTML version of a plain text message. */
export function brandedHtml(title: string, text: string): string {
  const body = escapeHtml(text).replace(/\n/g, "<br>");
  return `<!doctype html><html><body style="margin:0;background:#F6F7FB;font-family:Archivo,Arial,sans-serif;color:#14213D">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F6F7FB;padding:32px 0"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:16px;overflow:hidden">
<tr><td style="background:#14213D;padding:20px 28px;color:#FFFFFF;font-weight:800;font-size:18px;letter-spacing:.5px">Network Simulator<span style="color:#FF6B57"> ●</span></td></tr>
<tr><td style="padding:28px"><h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1><p style="margin:0;font-size:15px;line-height:24px;color:#4F5B73">${body}</p></td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #DCE1EB;font-size:12px;color:#4F5B73">Powered by RHIS</td></tr>
</table></td></tr></table></body></html>`;
}
