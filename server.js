"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const QUESTIONS = require("./config/questions.json");
const store = require("./lib/store");
const { collectAll } = require("./lib/collector");
const { buildReport } = require("./lib/report");

const APP_VERSION = "1.0.0";
const APP_NAME = "hutek-visibility";
const PORT = process.env.PORT || 3000;
const running = new Map(); // auditId -> {done,total}

function basicAuth(req, res, next) {
  const u = process.env.UI_USER, p = process.env.UI_PASS;
  if (!u || !p) return next();
  const h = req.headers.authorization || "";
  const [scheme, b64] = h.split(" ");
  if (scheme === "Basic") {
    const [ru, rp] = Buffer.from(b64 || "", "base64").toString().split(":");
    if (ru === u && rp === p) return next();
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="hutek-visibility"');
  return res.status(401).send("Authentification requise");
}
function needToken(req, res, next) {
  const t = process.env.ADMIN_TOKEN;
  if (!t) return next();
  if (req.headers["x-admin-token"] === t) return next();
  return res.status(403).json({ error: "jeton admin invalide" });
}
function auditMetaList() {
  const idx = store.readIndex();
  return idx.slice().reverse();
}
async function runAudit(auditId, onlyMissing) {
  const dir = store.auditDir(auditId);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  const cfg = QUESTIONS.collect;
  let questions = QUESTIONS.questions;
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8")); } catch {}
  if (onlyMissing) {
    const doneIds = new Set(existing.filter((r) => r.status === "ok_complete").map((r) => r.question_id));
    questions = questions.filter((q) => !doneIds.has(q.id));
  }
  running.set(auditId, { done: existing.filter((r) => r.status === "ok_complete").length, total: QUESTIONS.questions.length });
  const fresh = await collectAll(questions, { delayMs: parseInt(process.env.COLLECT_DELAY_MS || cfg.delayMs, 10), maxAttempts: cfg.maxAttempts, waitTimeoutMs: parseInt(process.env.COLLECT_WAIT_MS || cfg.waitTimeoutMs, 10), pollMs: 5000, resolveSources: true }, dir, (d, t, qid, st) => {
    const base = existing.filter((r) => r.status === "ok_complete").length;
    running.set(auditId, { done: base + 0, total: QUESTIONS.questions.length, current: qid, lastStatus: st });
    try {
      const cur = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
      running.set(auditId, { done: cur.filter((r) => r.status === "ok_complete").length, total: QUESTIONS.questions.length, current: qid, lastStatus: st });
    } catch {}
  });
  // Fusionne avec l'existant (reprise)
  let merged = existing.slice();
  if (onlyMissing) {
    const map = new Map(merged.map((r) => [r.question_id, r]));
    for (const r of fresh) map.set(r.question_id, r);
    merged = QUESTIONS.questions.map((q) => map.get(q.id) || { question_id: q.id, status: "manquante" });
    fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(merged, null, 2));
  } else merged = fresh;
  // Rapport
  const idx = store.readIndex();
  const prevId = idx.filter((a) => a.id !== auditId && a.status === "done").slice(-1)[0];
  let prev = null;
  if (prevId) { try { prev = store.readAudit(prevId.id); } catch {} }
  meta.finished_utc = new Date().toISOString();
  meta.status = "done";
  meta.complete = merged.filter((r) => r.status === "ok_complete").length;
  meta.total = merged.length;
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  const report = buildReport(meta, QUESTIONS.questions, merged, prev ? { meta: prev.meta, report: prev.report } : null);
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "report.html"), reportHtml(meta, report, merged));
  const i = idx.findIndex((a) => a.id === auditId);
  if (i >= 0) idx[i] = { id: auditId, dateKey: meta.dateKey, started_utc: meta.started_utc, finished_utc: meta.finished_utc, status: "done", complete: meta.complete, total: meta.total };
  store.writeIndex(idx);
  running.delete(auditId);
  return { meta, report };
}
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function reportHtml(meta, report, results) {
  const shots = results.filter((r) => r.capture).map((r) => {
    try {
      const b = fs.readFileSync(path.join(store.auditDir(meta.id), "screenshots", r.capture)).toString("base64");
      return "<figure><figcaption>" + esc(r.question_id + " — " + r.question_exacte) + "</figcaption><img src=\"data:image/png;base64," + b + "\" style=\"max-width:100%\"></figure>";
    } catch { return "<p>Capture manquante : " + esc(r.question_id) + "</p>"; }
  }).join("\n");
  return "<!doctype html><html lang=fr><head><meta charset=utf-8><title>Rapport " + esc(meta.id) + "</title><style>body{font-family:sans-serif;max-width:900px;margin:2em auto;padding:0 1em}figure{border:1px solid #ccc;padding:8px}</style></head><body><h1>Audit Hutek — Mode IA Google</h1><p>" + esc(meta.id) + " · " + esc(meta.started_utc) + " · protocole " + esc(meta.protocolVersion) + "</p><h2>Synthese</h2><ul>" + report.sections.synthese.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul><h2>Indicateurs (groupe B)</h2><pre>" + esc(JSON.stringify(report.indicateurs, null, 2)) + "</pre><h2>Limites</h2><ul>" + report.sections.limites.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul><h2>Actions</h2><ul>" + report.sections.actions.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul><h2>Captures</h2>" + shots + "</body></html>";
}

const app = express();
app.use(express.json({ limit: "512kb" }));
// Sante publique AVANT l'authentification (healthcheck Docker/Dokploy, sinon boucles de redemarrage)
app.get("/api/health", (req, res) => res.json({ status: "ok", app: APP_NAME, version: APP_VERSION, time: new Date().toISOString(), selenium: process.env.SELENIUM_URL || "http://10.0.1.153:4444", running: [...running.keys()] }));
app.use(basicAuth);
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (req, res) => res.json(QUESTIONS));
app.get("/api/audits", (req, res) => res.json(auditMetaList()));
app.post("/api/audits/start", needToken, (req, res) => {
  const dateKey = (req.body && req.body.dateKey) || new Date().toISOString().slice(0, 10);
  const idx = store.readIndex();
  if ([...running.keys()].length) return res.status(409).json({ error: "un audit est deja en cours", running: [...running.keys()] });
  const dup = idx.find((a) => a.dateKey === dateKey && a.status !== "failed");
  if (dup && !(req.body && req.body.force)) return res.json({ auditId: dup.id, reused: true, status: dup.status });
  const auditId = "aud-" + dateKey.replace(/-/g, "") + "-" + new Date().toISOString().slice(11, 19).replace(/:/g, "");
  const dir = store.auditDir(auditId);
  store.ensureDir(path.join(dir, "screenshots"));
  const meta = { id: auditId, dateKey, started_utc: new Date().toISOString(), status: "running", protocolVersion: QUESTIONS.protocolVersion, total: QUESTIONS.questions.length };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify([], null, 2));
  idx.push({ id: auditId, dateKey, started_utc: meta.started_utc, finished_utc: null, status: "running", complete: 0, total: meta.total });
  store.writeIndex(idx);
  running.set(auditId, { done: 0, total: meta.total });
  setImmediate(() => runAudit(auditId, false).catch((e) => {
    running.delete(auditId);
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
      m.status = "failed"; m.erreur = String(e.message || e).slice(0, 300);
      fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(m, null, 2));
      const ix = store.readIndex(); const k = ix.findIndex((a) => a.id === auditId);
      if (k >= 0) { ix[k].status = "failed"; store.writeIndex(ix); }
    } catch {}
  }));
  res.json({ auditId, status: "running" });
});
app.post("/api/audits/:id/resume", needToken, (req, res) => {
  const id = req.params.id;
  if ([...running.keys()].length) return res.status(409).json({ error: "un audit est deja en cours" });
  const dir = store.auditDir(id);
  if (!fs.existsSync(path.join(dir, "meta.json"))) return res.status(404).json({ error: "audit inconnu" });
  running.set(id, { done: 0, total: QUESTIONS.questions.length });
  setImmediate(() => runAudit(id, true).catch((e) => running.delete(id)));
  res.json({ auditId: id, status: "resumed" });
});
app.get("/api/audits/:id/status", (req, res) => {
  const id = req.params.id;
  if (running.has(id)) return res.json({ auditId: id, status: "running", ...running.get(id) });
  try {
    const { meta, results } = store.readAudit(id);
    res.json({ auditId: id, status: meta.status, done: results.filter((r) => r.status === "ok_complete").length, total: meta.total });
  } catch { res.status(404).json({ error: "audit inconnu" }); }
});
app.get("/api/audits/:id", (req, res) => {
  try {
    const a = store.readAudit(req.params.id);
    res.json({ meta: a.meta, questions: QUESTIONS.questions, results: a.results, report: a.report });
  } catch { res.status(404).json({ error: "audit inconnu" }); }
});
app.get("/api/audits/:id/report", (req, res) => {
  try {
    const a = store.readAudit(req.params.id);
    if (!a.report) return res.status(404).json({ error: "rapport non genere (audit en cours ?)" });
    res.json(a.report);
  } catch { res.status(404).json({ error: "audit inconnu" }); }
});
app.get("/api/audits/:id/report.html", (req, res) => {
  const f = path.join(store.auditDir(req.params.id), "report.html");
  if (!fs.existsSync(f)) return res.status(404).send("rapport non disponible");
  res.sendFile(f);
});
app.get("/api/audits/:id/export.json", (req, res) => {
  try {
    const a = store.readAudit(req.params.id);
    res.setHeader("Content-Disposition", "attachment; filename=\"" + req.params.id + ".json\"");
    res.json({ meta: a.meta, protocole: QUESTIONS.protocolVersion, questions: QUESTIONS.questions, results: a.results, report: a.report });
  } catch { res.status(404).json({ error: "audit inconnu" }); }
});
// Captures servies par l'application (jamais un chemin local brut)
app.get("/screenshots/:auditId/:file", (req, res) => {
  const f = path.join(store.auditDir(req.params.auditId), "screenshots", path.basename(req.params.file));
  if (!fs.existsSync(f)) return res.status(404).send("capture introuvable");
  res.sendFile(f);
});
// Documentation hutek-lab preservee (onglet secondaire exige)
app.get("/api/heritage", (req, res) => {
  try {
    const caps = JSON.parse(fs.readFileSync("/workspace/projects/hutek-lab/data/audits.json", "utf8"));
    res.json({ note: "vitrine hutek-lab conservee (documentation)", data: Array.isArray(caps) ? caps.length : 0 });
  } catch { res.json({ note: "vitrine hutek-lab conservee (documentation)", data: 0 }); }
});
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

if (require.main === module) {
  store.ensureDir(store.DATA_DIR);
  if (!fs.existsSync(store.auditsIndexPath())) store.writeIndex([]);
  app.listen(PORT, "0.0.0.0", () => console.log(APP_NAME + " v" + APP_VERSION + " on :" + PORT));
}
module.exports = { app, runAudit, APP_VERSION, APP_NAME };
