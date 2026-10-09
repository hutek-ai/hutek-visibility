"use strict";
// Rapport redige en francais, 100 % issu des observations. Chaque conclusion cite
// les recherches (IDs) et extraits qui la justifient. Aucun score global invente.
const { analyzeResult, indicators } = require("./analyze");
function pct(o) { return o.den ? Math.round(o.val * 100) + " % (" + o.num + "/" + o.den + ")" : "non calculable (aucune recherche reussie)"; }
function buildReport(auditMeta, questions, results, previous) {
  const byId = Object.fromEntries(questions.map((q) => [q.id, q]));
  const observations = results.map((r) => analyzeResult(byId[r.question_id] || { id: r.question_id, group: r.group || "?" }, r));
  const ind = indicators(observations);
  const okCount = results.filter((r) => r.status === "ok_complete").length;
  const failCount = results.length - okCount;
  const compFreq = {};
  observations.filter((o) => o.group === "B").forEach((o) => (o.concurrents || []).forEach((c) => { compFreq[c] = (compFreq[c] || 0) + 1; }));
  const topConcurrents = Object.entries(compFreq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nom, n]) => ({ nom, audits: n }));
  const lines = [];
  lines.push("Audit de visibilite Hutek dans le Mode IA de Google — " + auditMeta.id + " (" + auditMeta.started_utc + ").");
  lines.push(okCount + " recherche(s) reussie(s) et complete(s) sur " + results.length + " ; " + failCount + " echec(s) ou incomplet(s), exclus des taux.");
  lines.push("Visibilite spontanee (groupe B) : mention " + pct(ind.taux_mention) + ", recommandation " + pct(ind.taux_recommandation) + ", citation hutek.fr en sources " + pct(ind.taux_citation_domaine) + ".");
  if (previous && previous.report) {
    const p = previous.report.indicateurs;
    if (p && p.taux_mention.den && ind.taux_mention.den) {
      const d = (ind.taux_mention.val - p.taux_mention.val);
      lines.push("Evolution du taux de mention vs audit " + previous.meta.id + " : " + (d > 0 ? "+" : "") + d.toFixed(3) + " (protocole " + (auditMeta.protocolVersion === previous.meta.protocolVersion ? "identique" : "AYANT CHANGE : comparaison limitee") + ").");
    } else lines.push("Comparaison a l'audit precedent limitee (perimetres ou protocoles differents).");
  } else lines.push("Premier audit de la serie : aucune comparaison historique disponible.");
  const obsB = observations.filter((o) => o.group === "B" && o.status === "ok_complete");
  const obsA = observations.filter((o) => o.group === "A" && o.status === "ok_complete");
  const sections = {
    synthese: lines,
    observations_sans_hutek: obsB.map((o) => ({ question: o.question_id, mention: o.hutek_mention_texte, recommandee: o.hutek_recommandee, position: o.position_liste, hutek_fr_source: o.hutek_fr_en_sources, concurrents: o.concurrents, justification: o.recommandation_raison, extrait: (o.extraits.mention_hutek || "").slice(0, 300) })),
    observations_avec_hutek: obsA.map((o) => ({ question: o.question_id, ton: o.ton, confusion: o.confusion_possible || null, avis: o.avis_statut, points_forts: (o.points_forts_passages || []).slice(0, 3), limites: (o.limites_passages || []).slice(0, 3) })),
    changements: previous ? ["Voir synthese ci-dessus pour l'evolution chiffree ; protocole " + auditMeta.protocolVersion + " vs " + previous.meta.protocolVersion + "."] : ["Aucun historique : cet audit sert de reference."],
    limites: [
      "Observations valables uniquement dans les conditions testees (Mode IA, langue fr, date " + auditMeta.started_utc + ") ; ce n'est pas un classement universel de Google.",
      "Geolocalisation et compte non verifiables avec la session partagee ; conditions enregistrees telles quelles.",
      "Concurrents extraits par heuristique (items de liste) : indicatifs, non exhaustifs.",
      "Affirmations non verifiees restees « non verifiees » ; absence d'avis ne vaut ni bonne ni mauvaise reputation.",
      failCount ? failCount + " recherche(s) en echec exclue(s) des taux : " + ind.echecs_ids.join(", ") + "." : "Aucun echec technique sur cet audit."
    ],
    actions: [
      obsB.some((o) => o.hutek_recommandee) ? "Capitaliser sur les requetes ou Hutek est deja recommandee ; verifier la regularite sur 7 jours." : "Hutek absente des recommandations spontanees : travailler le referencement et les contenus repris par le Mode IA (etudes de cas, pages locales Lyon/AuRA).",
      obsA.some((o) => o.confusion_possible) ? "Lever l'ambiguite avec la SCI homonyme : preciser « Hutek Humain et Technologies — Lyon, hutek.fr » dans les contenus." : "Aucune confusion homonymique detectee sur cet audit.",
      "Surveiller hutek.fr en sources : " + ind.taux_citation_domaine.num + "/" + ind.taux_citation_domaine.den + " ; viser une presence systematique via pages factuelles."
    ]
  };
  return { audit_id: auditMeta.id, date_utc: auditMeta.started_utc, protocole: auditMeta.protocolVersion, completude: { reussies: okCount, total: results.length, echecs: failCount }, indicateurs: ind, top_concurrents: topConcurrents, sections, observations };
}
module.exports = { buildReport };
