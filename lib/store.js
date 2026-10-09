"use strict";
const fs = require("fs");
const path = require("path");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function auditsIndexPath() { return path.join(DATA_DIR, "audits.json"); }
function auditDir(id) { return path.join(DATA_DIR, "audits", id); }
function readIndex() {
  try { return JSON.parse(fs.readFileSync(auditsIndexPath(), "utf8")); }
  catch { return []; }
}
function writeIndex(list) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(auditsIndexPath(), JSON.stringify(list, null, 2));
}
function readAudit(id) {
  const d = auditDir(id);
  const meta = JSON.parse(fs.readFileSync(path.join(d, "meta.json"), "utf8"));
  let results = [];
  try { results = JSON.parse(fs.readFileSync(path.join(d, "results.json"), "utf8")); } catch {}
  let report = null;
  try { report = JSON.parse(fs.readFileSync(path.join(d, "report.json"), "utf8")); } catch {}
  return { meta, results, report };
}
module.exports = { DATA_DIR, ensureDir, auditsIndexPath, auditDir, readIndex, writeIndex, readAudit };
