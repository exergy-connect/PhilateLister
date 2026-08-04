#!/usr/bin/env node
/**
 * Expand Scott crosswalks for Iceland and Denmark from verified catalogue sources.
 *
 * Sources:
 * - Mostly Classics Iceland album (Scott + Facit denoms)
 * - Jay Smith Iceland/Denmark TOC ranges
 * - JF-Stamps / HipStamp confirmation points (AFA≈SW for many Nordic issues)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.resolve(ROOT, "../../public/catalogs");

const entry = (number, relation = "exact", status = "inferred") => ({
  number: String(number),
  relation,
  status,
});

const pad = (n) => {
  const s = String(n);
  const m = s.match(/^(\d+)([A-Za-z].*)?$/);
  if (!m) return s;
  return m[1].padStart(4, "0") + (m[2] || "");
};

function put(map, key, number, relation = "exact", status = "inferred") {
  const prev = map[key];
  if (prev?.status === "verified" && status !== "verified") return;
  map[key] = entry(number, relation, status);
}

function putIs(map, cat, ref, no, scott, relation = "exact", status = "inferred") {
  put(map, `${cat}::${ref}::${pad(no)}`, scott, relation, status);
}

function putDk(map, cat, no, scott, relation = "exact", status = "inferred") {
  put(map, `${cat}::${pad(no)}`, scott, relation, status);
}

const isCat = JSON.parse(fs.readFileSync(path.join(PUBLIC, "is.json"), "utf8"));

// ---------- Iceland ----------
const isPath = path.join(ROOT, "catalogs/scott/iceland.json");
const isDoc = JSON.parse(fs.readFileSync(isPath, "utf8"));
// Merge into existing maps (commemorative extensions live in extend_scott_commemoratives.mjs).
const isMap = { ...isDoc.mappings };

// Skillings — Scott/Facit are NOT StampWorld order. Mostly Classics album:
//   perf 14×13½: 2sk=1, 4sk=2, 8sk=3, 16sk=4; perf ~12½: 3sk=5, 4sk=6, 16sk=7.
putIs(isMap, "Postage stamps", "g0001", "0001", "1", "exact", "verified"); // 2Sk blue
putIs(isMap, "Postage stamps", "g0001", "0002", "5", "exact", "verified"); // 3Sk grey, perf 12¾
putIs(isMap, "Postage stamps", "g0001", "0003", "2", "exact", "verified"); // 4Sk carmine
putIs(isMap, "Postage stamps", "g0001", "0004", "3", "exact", "verified"); // 8Sk brown
putIs(isMap, "Postage stamps", "g0001", "0005", "4", "exact", "verified"); // 16Sk yellow

// First aur majors (perf 14×13½): Scott 9-14 (Scott 8 is the perf 12½ 5aur).
putIs(isMap, "Postage stamps", "g0006", "0006", "9");
putIs(isMap, "Postage stamps", "g0006", "0007", "10");
putIs(isMap, "Postage stamps", "g0006", "0008", "11");
putIs(isMap, "Postage stamps", "g0006", "0009", "12");
putIs(isMap, "Postage stamps", "g0006", "0010", "13");
putIs(isMap, "Postage stamps", "g0006", "0011", "14");

// 1882 colour changes / new values
putIs(isMap, "Postage stamps", "g0012", "0012", "15");
putIs(isMap, "Postage stamps", "g0012", "0013", "16");
putIs(isMap, "Postage stamps", "g0012", "0014", "17");
putIs(isMap, "Postage stamps", "g0012", "0015", "18");
putIs(isMap, "Postage stamps", "g0016", "0016", "19");
putIs(isMap, "Postage stamps", "g0016", "0017", "20");

putIs(isMap, "Postage stamps", "g0020", "0020", "23");
putIs(isMap, "Postage stamps", "g0020", "0021", "29");
putIs(isMap, "Postage stamps", "g0022", "0022", "22");
putIs(isMap, "Postage stamps", "g0018", "0018", "32");
putIs(isMap, "Postage stamps", "g0019", "0019", "33");

// Í GILDI postage — map by denomination to common Scott majors.
const gildiScottByDenom = {
  "4aur": "51",
  "5aur": "52",
  "6aur": "53",
  "10aur": "54",
  "16aur": "55",
  "20aur": "56",
  "25aur": "57",
  "40aur": "58",
  "50aur": "59",
  "100aur": "68",
};
for (const set of isCat.sets) {
  if (set.category !== "Postage stamps" || !/GILDI/i.test(set.name)) continue;
  if (!/^g00/.test(set.id)) continue;
  const ref = set.id.split("::")[0];
  for (const st of set.stamps || []) {
    const no = String(st.no || "").trim();
    if (!no) continue;
    const scott = gildiScottByDenom[String(st.denom || "")];
    if (scott) putIs(isMap, "Postage stamps", ref, no, scott);
  }
}
const g0023 = isCat.sets.find((s) => s.id.startsWith("g0023::"));
if (g0023) {
  const threes = (g0023.stamps || []).filter(
    (st) => String(st.no || "").trim() && st.denom === "3aur",
  );
  if (threes[0]) putIs(isMap, "Postage stamps", "g0023", threes[0].no, "50");
  if (threes[1]) putIs(isMap, "Postage stamps", "g0023", threes[1].no, "49");
}

const cix = ["34", "35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "44A", "44B"];
for (let i = 0; i < cix.length; i += 1) {
  putIs(isMap, "Postage stamps", "g0035", pad(35 + i), cix[i]);
}
for (let n = 48; n <= 62; n += 1) {
  putIs(isMap, "Postage stamps", "g0048", pad(n), String(n + 23));
}
for (let n = 63; n <= 68; n += 1) {
  putIs(isMap, "Postage stamps", "g0063", pad(n), String(n + 23));
}
for (let n = 69; n <= 75; n += 1) {
  putIs(isMap, "Postage stamps", "g0069", pad(n), String(n + 23));
}

const tw2 = isCat.sets.find((s) => s.id.startsWith("g0076::"));
if (tw2) {
  const scottSeq = ["99", "100", "101", "102", "103", "104", "107"];
  const nos = (tw2.stamps || []).map((st) => String(st.no || "").trim()).filter(Boolean);
  nos.forEach((no, i) => {
    if (scottSeq[i]) putIs(isMap, "Postage stamps", "g0076", no, scottSeq[i]);
  });
}

// Officials
putIs(isMap, "Official stamps", "g01", "0001", "O1", "exact", "verified");
putIs(isMap, "Official stamps", "g01", "0002", "O2", "exact", "verified");
for (let n = 3; n <= 9; n += 1) {
  putIs(isMap, "Official stamps", "g03", pad(n), `O${n}`, "exact", "verified");
}
for (let i = 0; i < 7; i += 1) {
  putIs(isMap, "Official stamps", "g17", pad(17 + i), `O${13 + i}`);
}
const g10 = isCat.sets.find((s) => s.id.startsWith("g10::"));
if (g10) {
  const offGildi = ["O20", "O21", "O22", "O23", "O24", "O25", "O26"];
  const nos = (g10.stamps || []).map((st) => String(st.no || "").trim()).filter(Boolean);
  nos.forEach((no, i) => {
    if (offGildi[i]) putIs(isMap, "Official stamps", "g10", no, offGildi[i]);
  });
}
const g24 = isCat.sets.find((s) => s.id.startsWith("g24::"));
if (g24) {
  const nos = (g24.stamps || []).map((st) => String(st.no || "").trim()).filter(Boolean);
  nos.forEach((no, i) => putIs(isMap, "Official stamps", "g24", no, `O${31 + i}`));
}

isDoc.mappings = isMap;
isDoc.version = 2;
isDoc.key_format =
  "<StampWorld category>::<StampWorld set ref>::<StampWorld stamp number>";
isDoc.sources = [
  "https://www.jaysmith.com/Lists/Iceland/IcelandTOC.html",
  "https://www.mostlyclassics.net/philatelic/Iceland_1873-1944_nopix.pdf",
  "https://jf-stamps.dk/en-GB/1966/1912-frederik-viii/1",
];
fs.writeFileSync(isPath, `${JSON.stringify(isDoc, null, 2)}\n`);
console.log(`wrote ${path.relative(ROOT, isPath)} (${Object.keys(isMap).length} mappings)`);

// ---------- Denmark ----------
const dkPath = path.join(ROOT, "catalogs/scott/denmark.json");
const dkDoc = JSON.parse(fs.readFileSync(dkPath, "utf8"));
const dkMap = { ...dkDoc.mappings };

const dkPostage = {
  "0060": "79",
  "0061": "80",
  "0062": "81",
  "0062a": ["81", "shade"],
  "0063": "82",
  "0063a": ["82", "shade"],
  "0064": "90",
  "0065": "91",
  "0066": "92",
  "0066a": ["92", "shade"],
  "0067": "96",
  "0068": "97",
  "0069": "98",
  "0070": "99",
  "0070a": ["99", "shade"],
  "0071": "100",
  "0072": "101",
  "0073": "102",
  "0074": "103",
  "0075": "104",
  "0076": "105",
  "0077": "106",
  "0078": "107",
  "0078a": ["107", "shade"],
  "0079": "108",
  "0079a": ["108", "shade"],
  "0080": "109",
  "0081": "135",
  "0084": "110",
};
for (const [no, val] of Object.entries(dkPostage)) {
  if (Array.isArray(val)) putDk(dkMap, "Postage stamps", no, val[0], val[1]);
  else putDk(dkMap, "Postage stamps", no, val);
}

const cx1918 = [
  ["0100", "111"],
  ["0101", "112"],
  ["0102", "113"],
  ["0103", "114"],
  ["0104", "115"],
  ["0105", "116"],
  ["0106", "117"],
  ["0107", "118"],
  ["0107a", "118"],
  ["0108", "119"],
  ["0109", "120"],
  ["0109a", "120"],
  ["0109b", "120"],
  ["0110", "121"],
  ["0111", "122"],
  ["0112", "123"],
  ["0112a", "123"],
];
for (const [no, scott] of cx1918) {
  putDk(
    dkMap,
    "Postage stamps",
    no,
    scott,
    /[ab]$/i.test(no) ? "shade" : "exact",
  );
}

putDk(dkMap, "Postage stamps", "0113", "145");
putDk(dkMap, "Postage stamps", "0114", "146");
putDk(dkMap, "Postage stamps", "0115", "147");
putDk(dkMap, "Postage stamps", "0116", "148");
putDk(dkMap, "Postage stamps", "0117", "149");

for (let n = 1; n <= 31; n += 1) {
  putDk(dkMap, "Postage ferry stamps", pad(n), `Q${n}`);
}
putDk(dkMap, "Postage ferry stamps", "0002a", "Q2", "shade");
putDk(dkMap, "Postage ferry stamps", "0007a", "Q7", "shade");
putDk(dkMap, "Postage ferry stamps", "0012a", "Q12", "shade");
putDk(dkMap, "Postage ferry stamps", "0016A", "Q16", "variety");
putDk(dkMap, "Postage ferry stamps", "0016B", "Q16", "variety");
putDk(dkMap, "Postage ferry stamps", "0021A", "Q21", "variety");

for (let n = 9; n <= 38; n += 1) {
  putDk(dkMap, "Postage-due stamps", pad(n), `J${n}`);
}
putDk(dkMap, "Postage-due stamps", "0036a", "J36", "shade");

dkDoc.mappings = dkMap;
dkDoc.version = 2;
dkDoc.sources = [
  ...new Set([
    ...(dkDoc.sources || []),
    "https://jf-stamps.dk/en-GB/lot/84172/denmark-1912-danmark-35-oere-surcharge-complete-set-on-beautiful-small",
    "https://www.hipstamp.com/listing/denmark-scott-135-used-copenhagen-post-office/10428572",
    "https://www.jaysmith.com/Lists/Denmark/DenmarkTOC.html",
  ]),
];
fs.writeFileSync(dkPath, `${JSON.stringify(dkDoc, null, 2)}\n`);
console.log(`wrote ${path.relative(ROOT, dkPath)} (${Object.keys(dkMap).length} mappings)`);

// Commemoratives / mid-period extensions (merges into the JSON files above).
await import("./extend_scott_commemoratives.mjs");

// Commemoratives / mid-period extensions (merges into the JSON files above).
await import("./extend_scott_commemoratives.mjs");
