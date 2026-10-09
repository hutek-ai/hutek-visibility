"use strict";
// Extraction deterministe d'observations. Aucun score global invente.
// Regles explicables documentees ici et reprises dans le rapport.
const HUTEK_RE = /\bhutek\b/i;
const HUTEK_URL_RE = /(^|\.)hutek\.fr$/i;
function hostnameOf(u) { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }
function excerpt(text, re, ctx) {
  const m = text.match(re);
  if (!m || m.index === undefined) return null;
  const start = Math.max(0, m.index - (ctx || 160));
  return text.slice(start, m.index + m[0].length + (ctx || 160)).replace(/\s+/g, " ").trim();
}
function listItems(text) {
  // Lignes de type liste : "1. Nom", "- Nom", "• Nom"
  return text.split("\n").map((l) => l.trim()).filter((l) => /^(\d{1,2}[.)\-:]\s+|[-•]\s+)/.test(l)).slice(0, 12);
}
function hutekListPosition(text) {
  const items = listItems(text);
  for (let i = 0; i < items.length; i++) {
    if (HUTEK_RE.test(items[i])) return { position: i + 1, ordered: true, items };
  }
  return { position: null, ordered: items.length > 0, items };
}
function isRecommended(text) {
  // Recommandation explicable : mention + (contexte recommandation proche OU item de liste)
  if (!HUTEK_RE.test(text)) return { recommended: false, reason: "aucune mention de Hutek dans le texte" };
  const ctxRe = /(recommande|propose|sugg[eè]re|retient|s[eé]lectionn|cabinet|entreprise|prestataire|partenaire|acteur)[\s\S]{0,300}hutek/i;
  const ctxRe2 = /hutek[\s\S]{0,200}(recommand[eé]|propos[eé]|s[eé]lectionn[eé]|retient|cit[eé]|adapt[eé]e?)/i;
  const m1 = text.match(ctxRe);
  if (m1) return { recommended: true, reason: "contexte de recommandation : « " + m1[0].replace(/\s+/g, " ").slice(0, 160) + " »" };
  const m2 = text.match(ctxRe2);
  if (m2) return { recommended: true, reason: "Hutek qualifier de recommandee : « " + m2[0].replace(/\s+/g, " ").slice(0, 160) + " »" };
  const lp = hutekListPosition(text);
  if (lp.position) return { recommended: true, reason: "Hutek figure en item n°" + lp.position + " d'une liste" };
  return { recommended: false, reason: "mention simple, sans contexte de recommandation ni item de liste" };
}
const STOP = new Set(["pour", "avec", "dans", "vous", "nous", "une", "des", "les", "cabinet", "cabinets", "entreprise", "entreprises", "france", "frances", "francais", "francaise", "accompagner", "accompagnement", "transformation", "intelligence", "artificielle", "adoption", "pme", "eti", "lyon", "region", "rhodanienne", "paris", "voici", "cinq", "cette", "ces", "sont", "leurs", "notre", "votre"]);
function competitors(text, max) {
  // Heuristique documentee : noms propres dans les items de liste, hors stopwords. Non exhaustif.
  const items = listItems(text);
  const out = [];
  for (const it of items) {
    if (HUTEK_RE.test(it)) continue;
    const cleaned = it.replace(/^(\d{1,2}[.)\-:]\s+|[-•]\s+)/, "").replace(/\s*[-–—:].*$/, "").trim();
    const name = cleaned.split(/\s+/).slice(0, 3).join(" ").replace(/["«»()]/g, "").trim();
    if (name.length >= 2 && name.length <= 60 && !STOP.has(name.toLowerCase().split(" ")[0]) && /^[A-ZÀ-Þ]/.test(name)) {
      if (!out.includes(name)) out.push(name);
    }
    if (out.length >= (max || 8)) break;
  }
  return out;
}
const POS_WORDS = ["expert", "innovant", "adapté", "adaptée", "atout", "point fort", "recommandé", "recommandée", "pertinent", "solide", "sérieux", "qualité", "positif"];
const NEG_WORDS = ["limite", "manque", "insuffisant", "risque", "faiblesse", "déconseillé", "négatif", "réserve", "incertain", "non vérifié", "peu d'avis", "aucun avis"];
function toneOf(text) {
  const low = text.toLowerCase();
  const pos = POS_WORDS.filter((w) => low.includes(w));
  const neg = NEG_WORDS.filter((w) => low.includes(w));
  let tone = "neutre";
  if (pos.length && neg.length) tone = "mixte";
  else if (pos.length) tone = "positif";
  else if (neg.length) tone = "négatif";
  return { tone, posWords: pos.slice(0, 6), negWords: neg.slice(0, 6) };
}
function sentencesWith(text, words) {
  const sents = text.split(/(?<=[.!?])\s+/);
  const low = words.map((w) => w.toLowerCase());
  return sents.filter((s) => low.some((w) => s.toLowerCase().includes(w))).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 20).slice(0, 6);
}
function analyzeResult(q, r) {
  // q: {id, group}, r: resultat brut {status, reponse, sources...}
  const text = (r && r.reponse_texte) || "";
  const sources = (r && r.sources) || [];
  const hutekMention = HUTEK_RE.test(text);
  const rec = isRecommended(text);
  const lp = hutekListPosition(text);
  const hutekFrSource = sources.some((s) => HUTEK_URL_RE.test(hostnameOf(s.url_finale || s.lien_original || "")));
  const obs = {
    question_id: q.id, group: q.group, status: r ? r.status : "manquante",
    hutek_mention_texte: hutekMention,
    hutek_recommandee: rec.recommended,
    recommandation_raison: rec.reason,
    position_liste: lp.position || "non applicable",
    liste_ordonnee_detectee: lp.ordered,
    hutek_fr_en_sources: hutekFrSource,
    concurrents: q.group === "B" ? competitors(text) : [],
    extraits: {}
  };
  const exMention = excerpt(text, HUTEK_RE, 180);
  if (exMention) obs.extraits.mention_hutek = exMention;
  if (q.group === "B") {
    if (hutekMention && !rec.recommended) obs.extraits.distinction = "Mention simple de Hutek sans recommandation : " + (exMention || "").slice(0, 240);
    if (hutekFrSource) {
      const s = sources.find((x) => HUTEK_URL_RE.test(hostnameOf(x.url_finale || x.lien_original || "")));
      if (s) obs.extraits.source_hutek_fr = (s.titre || "") + " — " + (s.url_finale || s.lien_original || "");
    }
  } else {
    const t = toneOf(text);
    obs.ton = t.tone; obs.ton_indices = { positifs: t.posWords, negatifs: t.negWords };
    obs.points_forts_passages = sentencesWith(text, ["point fort", "atout", "expert", "innovant", "adapté", "adaptée", "recommandé"]);
    obs.limites_passages = sentencesWith(text, ["limite", "manque", "réserve", "risque", "faiblesse", "incertain"]);
    const avis = sentencesWith(text, ["avis", "témoignage", "retour d'expérience", "google avis", "trustpilot"]);
    obs.avis_passages = avis;
    obs.avis_statut = avis.length ? "passages evoquant des avis (a verifier source par source)" : "aucun avis accessible dans la reponse";
    if (/sci\b|immobili|75017|mac-mahon/i.test(text)) obs.confusion_possible = "La reponse evoque aussi une SCI parisienne homonyme : verifier qu'il s'agit bien de Hutek Humain et Technologies (Lyon, hutek.fr).";
    obs.extraits.activite = text.replace(/\s+/g, " ").trim().slice(0, 700);
  }
  return obs;
}
function indicators(observations) {
  // Uniquement recherches sans marque reussies et completes. Echecs exclus du denominateur, affiches separement.
  const b = observations.filter((o) => o.group === "B");
  const ok = b.filter((o) => o.status === "ok_complete");
  const fails = b.filter((o) => o.status !== "ok_complete");
  const n = ok.length;
  const m = ok.filter((o) => o.hutek_mention_texte).length;
  const rec = ok.filter((o) => o.hutek_recommandee).length;
  const src = ok.filter((o) => o.hutek_fr_en_sources).length;
  return {
    perimetre: "recherches sans marque (groupe B), reussies et completes uniquement",
    reussies: n, echecs: fails.length, echecs_ids: fails.map((f) => f.question_id + ":" + f.status),
    taux_mention: { num: m, den: n, val: n ? +(m / n).toFixed(3) : null },
    taux_recommandation: { num: rec, den: n, val: n ? +(rec / n).toFixed(3) : null },
    taux_citation_domaine: { num: src, den: n, val: n ? +(src / n).toFixed(3) : null }
  };
}
module.exports = { analyzeResult, indicators, competitors, toneOf, HUTEK_RE };
