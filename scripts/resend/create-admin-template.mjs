#!/usr/bin/env node
// Creates the Resend admin notification template
// Variables: orderId, studentName, studentEmail, instructorName, sessionCount, purchaseAmount, currency, paymentProvider, dashboardUrl

import fs from "node:fs";
import path from "node:path";

function parseDotEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[k] = v;
    }
    return out;
  } catch { return {}; }
}

const cwd = process.cwd();
const envPathsToCheck = [
  path.join(cwd, ".env.local"),
  path.join(cwd, "apps/web/.env.local"),
  path.join(cwd, "apps/platform/.env.local"),
  path.join(cwd, ".env"),
];
const mergedEnv = {};
for (const p of envPathsToCheck) Object.assign(mergedEnv, parseDotEnvFile(p));

const RESEND_API_KEY = process.env.RESEND_API_KEY || mergedEnv.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || mergedEnv.EMAIL_FROM || "Huckleberry Mentorships <noreply@mentorships.huckleberry.art>";

if (!RESEND_API_KEY) {
  console.error("ERROR: RESEND_API_KEY is required");
  process.exit(1);
}

const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="color-scheme" content="light only" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>New Mentorship Purchase</title>
    <style>
      .container { max-width: 640px; margin: 0 auto; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: #111827; }
      .card { border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; }
      .h1 { font-size: 18px; font-weight: 700; margin: 12px 0; }
      .muted { color: #6B7280; }
      .button { display: inline-block; padding: 12px 16px; background: #111827; color: #ffffff !important; border-radius: 10px; text-decoration: none; font-weight: 600; }
      .row { margin: 6px 0; }
      .label { color: #6B7280; display: inline-block; width: 200px; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    </style>
  </head>
  <body>
    <div class="container" style="padding:24px">
      <div class="h1">New Mentorship Purchase</div>
      <div class="card">
        <div class="row"><span class="label">Order</span><strong class="mono">{{{orderId}}}</strong></div>
        <div class="row"><span class="label">Student</span><strong>{{{studentName}}}</strong> &lt;{{{studentEmail}}}&gt;</div>
        <div class="row"><span class="label">Instructor</span><strong>{{{instructorName}}}</strong></div>
        <div class="row"><span class="label">Sessions</span><strong>{{{sessionCount}}}</strong></div>
        <div class="row"><span class="label">Amount</span><strong>{{{purchaseAmount}}} {{{currency}}}</strong></div>
        <div class="row"><span class="label">Provider</span><strong>{{{paymentProvider}}}</strong></div>
        <div style="margin-top:12px">
          <a class="button" href="{{{dashboardUrl}}}">Open Admin</a>
        </div>
      </div>
    </div>
  </body>
</html>`;

const payload = {
  name: "admin-purchase-notification",
  from: EMAIL_FROM,
  subject: "New mentorship purchase — {{studentName}} with {{instructorName}}",
  html,
  variables: [
    { key: "orderId", type: "string", fallback_value: "" },
    { key: "studentName", type: "string", fallback_value: "" },
    { key: "studentEmail", type: "string", fallback_value: "" },
    { key: "instructorName", type: "string", fallback_value: "" },
    { key: "sessionCount", type: "number", fallback_value: 1 },
    { key: "purchaseAmount", type: "string", fallback_value: "0.00" },
    { key: "currency", type: "string", fallback_value: "USD" },
    { key: "paymentProvider", type: "string", fallback_value: "stripe" },
    { key: "dashboardUrl", type: "string", fallback_value: "https://your-app.example.com/admin" }
  ]
};

async function main() {
  const res = await fetch("https://api.resend.com/templates", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    console.error("ERROR: Template creation failed", { status: res.status, data });
    process.exit(1);
  }
  console.log(JSON.stringify({ id: data.id || data.template?.id || null, name: payload.name }));
}

main().catch((e) => { console.error("ERROR:", e?.message || String(e)); process.exit(1); });
