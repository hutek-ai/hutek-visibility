"use strict";
const S = { audits: [], current: null, detail: null };
const $ = (s) => document.querySelector(s);
async function j(u, o) { const r = await fetch(u, o); const t = await r.json().catch(() => ({})); if (!r.ok) throw new Error(t.error || ("HTTP " + r.status)); return t; }
function shot(auditId, f) { return "/screenshots/" + encodeURIComponent(auditId) + "/" + encodeURIComponent(f); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
async function boot() {
  document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("on"));
    $("#v-" + b.dataset.t).classList.add("on");
  });
  try {
    const h = await j("/api/health");
    $("#health").textContent = "API " + h.status + " · v" + h.version + (h.running.length ? " · audit en cours" : " · inactif");
  } catch (e) { $("#health").textContent = "API injoignable"; }
  try { S.audits = await j("/api/audits"); } catch { S.audits = []; }
  const last = S.audits.filter((a) => a.status === "done").slice(-1)[0] || S.audits.slice(-1)[0];
  if (last) await loadAudit(last.id);
  else $("#v-synthese").innerHTML = "<p>Aucun audit pour le moment. Lancez un audit manuel.</p>";
  renderHist();
  $("#btnRun").onclick = runManual;
  try { const hh = await j("/api/heritage"); $("#heritage").textContent = "héritage hutek-lab : " + hh.note + "."; } catch {}
  const dlg = $("#dlg");
  dlg.onclick = () => dlg.close();
}
async function loadAudit(id) {
  S.detail = await j("/api/audits/" + encodeURIComponent(id));
  S.current = id;
  $("#lnkReport").href = "/api/audits/" + encodeURIComponent(id) + "/report.html";
  $("#lnkJson").href = "/api/audits/" + encodeURIComponent(id) + "/export.json";
  renderSynthese(); renderGroup("B"); renderGroup("A"); renderRep(S.detail.results[0] ? S.detail.results[0].question_id : null);
}
function renderSynthese() {
  const d = S.detail, rep = d.report;
  if (!rep) { $("#v-synthese").innerHTML = "<p>Audit <b>" + esc(d.meta.id) + "</b> en cours : " + esc(String(d.meta.status)) + ". Actualisez dans quelques minutes.</p>"; return; }
  const ind = rep.indicateurs;
  const f = (o) => o.den ? Math.round(o.val * 100) + " % <span class=mut>(" + o.num + "/" + o.den + ")</span>" : "<span class=mut>non calculable</span>";
  $("#v-synthese").innerHTML =
    "<h2>Dernier audit : " + esc(d.meta.id) + "</h2><p class=mut>" + esc(d.meta.started_utc) + " · protocole " + esc(d.meta.protocole) + " · complétude " + rep.completude.reussies + "/" + rep.completude.total + "</p>"
    + "<div class=kpi><div><b>" + f(ind.taux_mention) + "</b><br>Mention spontanée</div><div><b>" + f(ind.taux_recommandation) + "</b><br>Recommandation</div><div><b>" + f(ind.taux_citation_domaine) + "</b><br>hutek.fr en sources</div><div><b>" + ind.echecs + "</b><br>Échecs exclus des taux<br><span class=mut>" + esc(ind.echecs_ids.join(", ") || "aucun") + "</span></div></div>"
    + "<h3>Synthèse</h3><ul>" + rep.sections.synthese.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul>"
    + "<h3>Concurrents les plus recommandés</h3>" + (rep.top_concurrents.length ? "<table><tr><th>Nom (heuristique)</th><th>Présence</th></tr>" + rep.top_concurrents.map((c) => "<tr><td>" + esc(c.nom) + "</td><td>" + c.audits + "</td></tr>").join("") + "</table>" : "<p class=mut>Aucun concurrent extrait.</p>")
    + "<h3>Actions proposées</h3><ul>" + rep.sections.actions.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul>"
    + "<h3>Limites</h3><ul>" + rep.sections.limites.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul>";
}
function renderGroup(g) {
  const d = S.detail;
  const obs = (d.report ? d.report.observations : []).filter((o) => o.group === g);
  const res = Object.fromEntries(d.results.map((r) => [r.question_id, r]));
  const el = g === "B" ? $("#v-sans") : $("#v-avec");
  el.innerHTML = "<h2>" + (g === "B" ? "Recherches sans mention de Hutek" : "Recherches avec Hutek mentionnée") + "</h2>" + obs.map((o) => {
    const r = res[o.question_id] || {};
    const srcs = (r.sources || []).map((s) => "<li><a href=\"" + esc(s.url_finale || s.lien_original) + "\" target=_blank rel=noopener>" + esc(s.titre || s.url_finale || s.lien_original) + "</a><br><span class=mut>" + esc(s.url_finale || s.lien_original) + (s.finale_obtenue ? "" : " (finale non obtenue)") + "</span></li>").join("");
    const img = r.capture ? "<a href=\"" + shot(d.meta.id, r.capture) + "\" download><img class=shot data-full=\"" + shot(d.meta.id, r.capture) + "\" src=\"" + shot(d.meta.id, r.capture) + "\" alt=\"capture " + esc(o.question_id) + "\" loading=lazy></a><br><a href=\"" + shot(d.meta.id, r.capture) + "\" download>Télécharger la capture</a>" : "<p class=mut>Capture indisponible (" + esc(r.status || "?") + ").</p>";
    const spec = g === "B"
      ? "<p>Mention : <b>" + (o.hutek_mention_texte ? "oui" : "non") + "</b> · Recommandée : <b>" + (o.hutek_recommandee ? "oui" : "non") + "</b> · Position : <b>" + esc(String(o.position_liste)) + "</b> · hutek.fr en sources : <b>" + (o.hutek_fr_en_sources ? "oui" : "non") + "</b><br><span class=mut>" + esc(o.recommandation_raison || "") + "</span>" + (o.extraits.mention_hutek ? "<br>Extrait : « " + esc(o.extraits.mention_hutek.slice(0, 280)) + " »" : "") + "</p>"
      : "<p>Ton : <b>" + esc(o.ton || "?") + "</b> · Avis : " + esc(o.avis || o.avis_statut || "") + (o.confusion ? "<br>⚠ " + esc(o.confusion) : "") + "</p>";
    return "<div class=card><h3>" + esc(o.question_id) + " — " + esc(r.question_exacte || "") + " <span class=mut>[" + esc(r.status || "?") + "]</span></h3>" + spec
      + "<p><button class=\"btn ghost\" data-rep=\"" + esc(o.question_id) + "\">Voir la réponse complète</button></p>"
      + "<div class=src><b>Sources (" + (r.sources || []).length + ")</b><ul>" + (srcs || "<li class=mut>Aucune</li>") + "</ul></div>" + img + "</div>";
  }).join("") || "<p class=mut>Rapport en cours de génération.</p>";
  el.querySelectorAll("img.shot").forEach((im) => im.onclick = (e) => { e.preventDefault(); $("#dlgImg").src = im.dataset.full; $("#dlg").showModal(); });
  el.querySelectorAll("[data-rep]").forEach((b) => b.onclick = () => { renderRep(b.dataset.rep); document.querySelector('[data-t="rep"]').click(); });
}
function renderRep(qid) {
  const d = S.detail; if (!d) return;
  const r = d.results.find((x) => x.question_id === qid) || d.results[0]; if (!r) { $("#v-rep").innerHTML = "<p>Aucune réponse.</p>"; return; }
  const others = d.results.map((x) => "<option " + (x.question_id === r.question_id ? "selected" : "") + " value=\"" + x.question_id + "\">" + x.question_id + "</option>").join("");
  $("#v-rep").innerHTML = "<h2>Réponse complète — " + esc(r.question_id) + "</h2><p><select id=selRep>" + others + "</select> <span class=mut>" + esc(r.status || "") + " · " + esc(r.horodatage_utc || "") + " · " + esc(String(r.duree_ms || "")) + " ms</span></p><p class=mut><a href=\"" + esc(r.page_url || "#") + "\" target=_blank rel=noopener>URL de la conversation Mode IA</a></p><pre>" + esc(r.reponse_texte || r.erreur || "(vide)") + "</pre>" + (r.capture ? "<img class=shot src=\"" + shot(d.meta.id, r.capture) + "\"> " : "");
  $("#selRep").onchange = (e) => renderRep(e.target.value);
}
function renderHist() {
  $("#v-hist").innerHTML = "<h2>Historique des audits</h2><table><tr><th>Audit</th><th>Date</th><th>Statut</th><th>Complétude</th><th></th></tr>" + S.audits.map((a) => "<tr><td>" + esc(a.id) + "</td><td>" + esc(a.started_utc || "") + "</td><td>" + esc(a.status) + "</td><td>" + (a.complete != null ? a.complete + "/" + a.total : "?") + "</td><td><button class=\"btn ghost\" data-a=\"" + esc(a.id) + "\">Ouvrir</button></td></tr>").join("") + "</table>";
  document.querySelectorAll("[data-a]").forEach((b) => b.onclick = async () => { await loadAudit(b.dataset.a); document.querySelector('[data-t="synthese"]').click(); });
}
async function runManual() {
  const b = $("#btnRun");
  if (b.disabled) return;
  b.disabled = true; b.textContent = "Lancement…";
  try {
    const r = await j("/api/audits/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    alert("Audit " + (r.reused ? "réutilisé (même date) : " : "lancé : ") + r.auditId + "\nSuivi via l'historique. Durée indicative 15-20 min.");
    S.audits = await j("/api/audits"); renderHist();
  } catch (e) { alert("Lancement impossible : " + e.message); }
  finally { b.disabled = false; b.textContent = "Lancer un audit manuel"; }
}
boot();
