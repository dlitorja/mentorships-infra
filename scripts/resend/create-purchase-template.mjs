#!/usr/bin/env node
// Creates the Resend purchase-onboarding template via HTTP API using .env.local
// Reads RESEND_API_KEY and EMAIL_FROM from .env.local (fallback to process.env).

import fs from "node:fs";
import path from "node:path";

function parseDotEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const out = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    }
    return out;
  } catch (_) {
    return {};
  }
}

const cwd = process.cwd();
const envPathsToCheck = [
  path.join(cwd, ".env.local"),
  path.join(cwd, "apps/web/.env.local"),
  path.join(cwd, "apps/platform/.env.local"),
  path.join(cwd, ".env"),
];
const mergedEnv = {};
for (const p of envPathsToCheck) {
  const obj = parseDotEnvFile(p);
  Object.assign(mergedEnv, obj);
}

const RESEND_API_KEY = process.env.RESEND_API_KEY || mergedEnv.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || mergedEnv.EMAIL_FROM || "Huckleberry Mentorships <onboarding@huckleberry.art>";

if (!RESEND_API_KEY) {
  console.error("ERROR: RESEND_API_KEY is required in environment or .env.local");
  process.exit(1);
}

const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="color-scheme" content="light only" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Welcome to your mentorship</title>
    <style>
      .container { max-width: 640px; margin: 0 auto; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: #111827; }
      .card { border: 1px solid #E5E7EB; border-radius: 12px; padding: 16px; }
      .h1 { font-size: 18px; font-weight: 700; margin: 12px 0; }
      .muted { color: #6B7280; }
      .button { display: inline-block; padding: 12px 16px; background: #111827; color: #ffffff !important; border-radius: 10px; text-decoration: none; font-weight: 600; }
      .list { margin: 0; padding-left: 18px; line-height: 1.7; color: #374151; }
    </style>
  </head>
  <body>
    <div class="container" style="padding:24px">
      <div class="h1">Huckleberry Mentorships</div>
      <div class="card">
        <div style="font-weight:700; margin-bottom:6px">
          Welcome, {{{studentName}}}
        </div>
        <div style="color:#374151; line-height:1.6; margin-bottom:12px">
          Your mentorship with <strong>{{{instructorName}}}</strong> is ready.
        </div>

        <div style="margin:0 0 12px 0; color:#374151">
          <div style="font-weight:700; margin-bottom:6px">Next steps</div>
          <ul class="list">
            <li>Open your Dashboard</li>
            <li>From the Dashboard: connect your Discord account</li>
            <li>Complete onboarding (goals + 2–4 images)</li>
            <li>Access your workspace with your instructor</li>
          </ul>
        </div>

        <a class="button" href="{{{dashboardUrl}}}">Open your Dashboard</a>

        <p class="muted" style="margin:16px 0 0 0; font-size:12px">
          If the button doesn’t work, copy/paste this link:<br/>
          <span>{{{dashboardUrl}}}</span>
        </p>

        <p class="muted" style="margin:12px 0 0 0; font-size:12px">
          Need help? Reply to this email or contact support@huckleberry.art.
        </p>
      </div>
    </div>
  </body>
</html>`;

const payload = {
  name: "purchase-onboarding",
  from: EMAIL_FROM,
  subject: "Welcome to your mentorship with {{instructorName}}",
  html,
  variables: [
    { key: "studentName", type: "string", fallback_value: "" },
    { key: "instructorName", type: "string", fallback_value: "your instructor" },
    { key: "dashboardUrl", type: "string", fallback_value: "https://your-app.example.com/dashboard" }
  ]
};

async function main() {
  const res = await fetch("https://api.resend.com/templates", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    console.error("ERROR: Template creation failed", { status: res.status, data });
    process.exit(1);
  }

  // Print only the essentials, no secrets
  const out = { id: data.id || data.template?.id || null, name: payload.name };
  console.log(JSON.stringify(out));
}

main().catch((err) => {
  console.error("ERROR:", err?.message || String(err));
  process.exit(1);
});
