"use strict";
const assert = require("node:assert");
const fs = require("node:fs");
const Q = require("../config/questions.json");
assert.equal(Q.questions.length, 13, "13 questions");
const ids = Q.questions.map((q) => q.id);
assert.deepEqual(ids, ["A1","A2","A3","A4","A5","A6","A7","B1","B2","B3","B4","B5","B6"], "ids stables");
for (const q of Q.questions) assert.ok(q.text && q.text.length > 10, "formulation exacte " + q.id);
const { analyzeResult, indicators } = require("../lib/analyze");
// Cas B : recommandation explicite
const o1 = analyzeResult({ id: "B1", group: "B" }, { status: "ok_complete", reponse_texte: "Voici mes recommandations :\n1. Capgemini\n2. Hutek, cabinet lyonnais expert IA\n3. Sopra Steria", sources: [{ titre: "Hutek", lien_original: "https://www.google.com/goto?x", url_finale: "https://www.hutek.fr/services" }] });
assert.equal(o1.hutek_mention_texte, true);
assert.equal(o1.hutek_recommandee, true);
assert.equal(o1.position_liste, 2);
assert.equal(o1.hutek_fr_en_sources, true);
// Cas B : absence
const o2 = analyzeResult({ id: "B1", group: "B" }, { status: "ok_complete", reponse_texte: "1. Capgemini\n2. Sopra Steria\n3. Accenture", sources: [] });
assert.equal(o2.hutek_mention_texte, false);
assert.equal(o2.hutek_recommandee, false);
assert.equal(o2.position_liste, "non applicable");
// Echec exclu des taux
const ind = indicators([o1, { ...o2, status: "bloquee", question_id: "B2", group: "B" }]);
assert.equal(ind.reussies, 1); assert.equal(ind.echecs, 1);
assert.deepEqual([ind.taux_mention.num, ind.taux_mention.den], [1, 1]);
// Groupe A : ton + confusion homonyme
const o3 = analyzeResult({ id: "A1", group: "A" }, { status: "ok_complete", reponse_texte: "Hutek Humain et Technologies est un cabinet expert et innovant. Il existe aussi une SCI Hutek au 75017 Paris pour l'immobilier.", sources: [] });
assert.ok(["positif","mixte","neutre"].includes(o3.ton));
assert.ok(o3.confusion_possible, "homonyme detecte");
// Serveur : dur, pas de secret
const srv = fs.readFileSync(__dirname + "/../server.js", "utf8");
assert.ok(!/DOKPLOY_API|GITHUB_PERSONAL|MISTRAL/.test(srv), "aucun secret dans le code");
console.log("OK tests hutek-visibility");
