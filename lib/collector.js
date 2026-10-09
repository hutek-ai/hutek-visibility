"use strict";
// Collecteur Google Mode IA via Selenium WebDriver (HTTP brut, zero dependance).
// Protocole : une navigation fraiche par question (nouvelle conversation, nouveau mstk),
// sans instruction cachee. Rapport honnete des echecs, jamais de reponse inventee.
const http = require("http");
const fs = require("fs");
const path = require("path");
function selHost() {
  const u = process.env.SELENIUM_URL || "http://google-browser:4444";
  const m = u.match(/^http:\/\/([^:/]+)(?::(\d+))?/);
  return { host: (m && m[1]) || "google-browser", port: parseInt((m && m[2]) || "4444", 10) };
}
function req(method, p, body, timeout) {
  const { host, port } = selHost();
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ hostname: host, port, path: p, method, headers: { "Content-Type": "application/json", ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) }, timeout: timeout || 30000 }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    r.on("error", (e) => resolve({ error: String(e.message || e).slice(0, 200) }));
    r.on("timeout", () => { r.destroy(); resolve({ error: "timeout" }); });
    if (data) r.write(data);
    r.end();
  });
}
async function findOrCreateSession() {
  const st = await req("GET", "/status", null, 10000);
  try {
    const j = JSON.parse(st.body);
    const nodes = (j.value && j.value.nodes) || [];
    for (const n of nodes) for (const s of (n.slots || [])) {
      if (s.session && s.session.sessionId) return s.session.sessionId;
    }
  } catch {}
  const c = await req("POST", "/wd/hub/session", { capabilities: { browserName: "chrome", "goog:chromeOptions": { args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=fr-FR"] } } }, 60000);
  try { return JSON.parse(c.body).value.sessionId || JSON.parse(c.body).sessionId; } catch { throw new Error("session selenium impossible : " + (c.body || c.error || "?").slice(0, 200)); }
}
async function wdExec(sid, js) {
  const r = await req("POST", "/wd/hub/session/" + sid + "/execute/sync", { script: js, args: [] }, 30000);
  try { return JSON.parse(r.body).value; } catch { return null; }
}
function resolveUrl(u, timeoutMs) {
  // Resolution best-effort de l'URL finale (suit les redirections). Echec = finale non obtenue.
  return new Promise((resolve) => {
    try {
      const lib = u.startsWith("https") ? require("https") : http;
      const r = lib.request(u, { method: "GET", timeout: timeoutMs || 10000, headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, u).toString();
          res.resume();
          if (next.startsWith("https://consent.youtube.com") || next.startsWith("https://consent.google.com")) return resolve({ finale: next, ok: false, note: "mur de consentement, lien original conserve" });
          return resolve(resolveUrl(next, timeoutMs));
        }
        res.resume();
        resolve({ finale: u, ok: res.statusCode < 400 });
      });
      r.on("timeout", () => { r.destroy(); resolve({ finale: u, ok: false, note: "timeout resolution" }); });
      r.on("error", (e) => resolve({ finale: u, ok: false, note: String(e.message).slice(0, 100) }));
      r.end();
    } catch (e) { resolve({ finale: u, ok: false, note: String(e.message).slice(0, 100) }); }
  });
}
const BLOCK_RE = /not a robot|unusual traffic|recaptcha|captcha|notre système a détecté|confirmer que vous n'êtes pas un robot/i;
const READY_RE = /la réponse du mode.?ia est prête|mode.?ia est prête/i;
async function collectOne(sid, q, cfg, shotPath) {
  const t0 = Date.now();
  const url = "https://www.google.com/search?udm=50&q=" + encodeURIComponent(q.text) + "&hl=fr&gl=fr&csuir=1";
  const out = { question_id: q.id, group: q.group, question_exacte: q.text, horodatage_utc: new Date().toISOString(), conditions: { langue: "hl=fr, gl=fr", compte: "non verifiable (session navigateur partagee)", localisation: "non verifiable (supposee FR via hl/gl)", navigateur: "chrome distant via selenium" } };
  for (let attempt = 1; attempt <= (cfg.maxAttempts || 2); attempt++) {
    out.tentative = attempt;
    const nav = await req("POST", "/wd/hub/session/" + sid + "/url", { url }, 30000);
    if (nav.error) { out.status = "echec_technique"; out.erreur = "navigation: " + nav.error; continue; }
    // Attente fin de generation
    let text = "", stable = 0, lastLen = 0, ready = false, blocked = false;
    const deadline = Date.now() + (cfg.waitTimeoutMs || 90000);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, cfg.pollMs || 5000));
      text = (await wdExec(sid, "return document.documentElement ? document.documentElement.innerText : ''")) || "";
      if (BLOCK_RE.test(text)) { blocked = true; break; }
      if (READY_RE.test(text)) ready = true;
      if (text.length === lastLen && text.length > 500) { stable++; } else stable = 0;
      lastLen = text.length;
      if (ready && stable >= 2 && text.length > 500) break;
    }
    const cur = await req("GET", "/wd/hub/session/" + sid + "/url", null, 15000);
    try { out.page_url = JSON.parse(cur.body).value; } catch { out.page_url = url; }
    out.duree_ms = Date.now() - t0;
    if (blocked) { out.status = "bloquee"; out.erreur = "blocage/CAPTCHA detecte, sans contournement"; out.reponse_texte = (text || "").slice(0, 2000); return out; }
    if (!text || text.length < 200) { out.status = "incomplete"; out.erreur = "reponse vide ou trop courte (" + (text || "").length + " car.)"; out.reponse_texte = text; continue; }
    const inAiMode = /udm=50/.test(out.page_url || "") && /mode.?ia/i.test(text);
    out.mode_ia_verifie = !!inAiMode;
    out.reponse_texte = text;
    out.generateur_pret = ready;
    if (!inAiMode) out.avertissement = "presence du Mode IA non confirmee sur cette page";
    // Sources : liens /goto
    let gotos = [];
    try {
      gotos = (await wdExec(sid, `return Array.from(document.querySelectorAll('a[href*=\"/goto?url=\"]')).slice(0,40).map(a=>({href:a.href, texte:(a.innerText||'').slice(0,200)}))`)) || [];
    } catch {}
    const seen = new Set();
    const sources = [];
    if (cfg.resolveSources !== false) {
      for (const g of gotos.slice(0, 15)) {
        if (!g.href || seen.has(g.href)) continue;
        seen.add(g.href);
        const rr = await resolveUrl(g.href, 10000);
        sources.push({ titre: g.texte || "(sans titre)", lien_original: g.href, url_finale: rr.finale, finale_obtenue: !!rr.ok, note: rr.note || null });
      }
    } else {
      for (const g of gotos) {
        if (!g.href || seen.has(g.href)) continue;
        seen.add(g.href);
        sources.push({ titre: g.texte || "(sans titre)", lien_original: g.href, url_finale: null, finale_obtenue: false, note: "resolution desactivee" });
      }
    }
    out.sources = sources;
    // Capture
    try {
      const shot = await req("GET", "/wd/hub/session/" + sid + "/screenshot", null, 30000);
      const b64 = JSON.parse(shot.body).value;
      fs.mkdirSync(path.dirname(shotPath), { recursive: true });
      fs.writeFileSync(shotPath, Buffer.from(b64, "base64"));
      out.capture = path.basename(shotPath);
    } catch (e) { out.capture_erreur = String(e.message || e).slice(0, 150); }
    // Statut final
    if (!ready) out.status = "incomplete";
    else if (!inAiMode) out.status = "incomplete";
    else out.status = "ok_complete";
    if (out.status !== "ok_complete" && attempt < (cfg.maxAttempts || 2)) continue;
    return out;
  }
  return out;
}
async function collectAll(questions, cfg, auditDir, onProgress) {
  const sid = await findOrCreateSession();
  const results = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const shot = path.join(auditDir, "screenshots", q.id + ".png");
    let r;
    try { r = await collectOne(sid, q, cfg, shot); }
    catch (e) { r = { question_id: q.id, group: q.group, question_exacte: q.text, horodatage_utc: new Date().toISOString(), status: "echec_technique", erreur: String(e.message || e).slice(0, 300) }; }
    results.push(r);
    fs.writeFileSync(path.join(auditDir, "results.json"), JSON.stringify(results, null, 2));
    if (onProgress) onProgress(i + 1, questions.length, q.id, r.status);
    if (i < questions.length - 1) await new Promise((res) => setTimeout(res, cfg.delayMs || 8000));
  }
  return results;
}
module.exports = { collectAll, collectOne, findOrCreateSession };
