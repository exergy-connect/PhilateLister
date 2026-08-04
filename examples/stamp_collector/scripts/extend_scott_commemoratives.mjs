#!/usr/bin/env node
/**
 * Extend Iceland & Denmark Scott crosswalks with later commemoratives / mid-period issues.
 *
 * Sources:
 * - Mostly Classics Iceland album (Scott + Facit denoms) through 1944
 * - Jay Smith Iceland/Denmark Scott listings (denoms + issue titles)
 * - Pressdat Denmark 1924 postal anniversary Scott 164-175
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

function mapSeq(map, putter, nos, scotts) {
  const a = [...nos];
  const b = [...scotts];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) putter(a[i], b[i]);
}

const isCat = JSON.parse(fs.readFileSync(path.join(PUBLIC, "is.json"), "utf8"));
const dkCat = JSON.parse(fs.readFileSync(path.join(PUBLIC, "dk.json"), "utf8"));

function stampsOf(catDoc, category, ref) {
  const set = catDoc.sets.find(
    (s) => s.category === category && String(s.id).startsWith(`${ref}::`),
  );
  if (!set) return [];
  return (set.stamps || [])
    .map((st) => ({ no: String(st.no || "").trim(), denom: String(st.denom || "") }))
    .filter((st) => st.no);
}

// ---------- Iceland ----------
const isPath = path.join(ROOT, "catalogs/scott/iceland.json");
const isDoc = JSON.parse(fs.readFileSync(isPath, "utf8"));
const isMap = { ...isDoc.mappings };
const beforeIs = Object.keys(isMap).length;

const isP = (ref, no, scott, rel, st) =>
  putIs(isMap, "Postage stamps", ref, no, scott, rel, st);

// 1921-22 Christian X new colours: 5/10/20/25/40 → Scott 112,116,119,121,124
mapSeq(
  isMap,
  (no, scott) => isP("g0099", no, scott),
  stampsOf(isCat, "Postage stamps", "g0099").map((s) => s.no),
  ["112", "116", "119", "121", "124"],
);

// 1921-22 surcharges (Christian IX / Two Kings pairs + 10 on 5)
{
  const sts = stampsOf(isCat, "Postage stamps", "g0104");
  const scottByDenom = {
    "5/16aur": ["130", "131"],
    "10/5aur": ["139"],
    "20/25aur": ["132", "133"],
    "20/40aur": ["134", "135"],
  };
  const used = {};
  for (const st of sts) {
    const list = scottByDenom[st.denom];
    if (!list) continue;
    const i = used[st.denom] || 0;
    if (list[i]) isP("g0104", st.no, list[i]);
    used[st.denom] = i + 1;
  }
}

isP("g0111", "0111", "140"); // 10kr on 1kr
isP("g0112", "0112", "137"); // 30 on 50
isP("g0112", "0113", "138"); // 50 on 5kr

// 1925 Landscapes
mapSeq(
  isMap,
  (no, scott) => isP("g0114", no, scott),
  stampsOf(isCat, "Postage stamps", "g0114").map((s) => s.no),
  ["144", "145", "146", "147", "148"],
);

isP("g0119", "0119", "149"); // 2kr on 25aur
isP("g0119", "0120", "143"); // 10kr on 5kr (SW denom label odd; Facit/Scott 143)
isP("g0121", "0121", "150"); // EIN KRÓNA on 40aur
isP("g0122", "0122", "C1");
isP("g0122", "0123", "C2");
isP("g0124", "0124", "141"); // 10kr on 2kr

// 1930 Althing postage (15 Scott; SW has trailing extra 10aur — skip last)
{
  const sts = stampsOf(isCat, "Postage stamps", "g0125");
  const scotts = [
    "152", "153", "154", "155", "156", "157", "158", "159", "160", "161", "162",
    "163", "164", "165", "166",
  ];
  mapSeq(
    isMap,
    (no, scott) => isP("g0125", no, scott),
    sts.slice(0, 15).map((s) => s.no),
    scotts,
  );
}
isP("g0141", "0141", "142"); // 10kr on 5kr Allthing-era

// Althing airmails
mapSeq(
  isMap,
  (no, scott) => isP("g0142", no, scott),
  stampsOf(isCat, "Postage stamps", "g0142").map((s) => s.no),
  ["C4", "C5", "C6", "C7", "C8"],
);

// Zeppelin
mapSeq(
  isMap,
  (no, scott) => isP("g0147", no, scott),
  stampsOf(isCat, "Postage stamps", "g0147").map((s) => s.no),
  ["C9", "C10", "C11"],
);

// Gullfoss
mapSeq(
  isMap,
  (no, scott) => isP("g0150", no, scott),
  stampsOf(isCat, "Postage stamps", "g0150").map((s) => s.no),
  ["170", "171", "172", "173", "174", "175"],
);

// Christian X redrawn (incl. 7 & 40 later listed in same SW set)
mapSeq(
  isMap,
  (no, scott) => isP("g0156", no, scott),
  stampsOf(isCat, "Postage stamps", "g0156").map((s) => s.no),
  ["176", "177", "178", "179", "180", "181", "182", "183", "184", "185", "186", "187"],
);

// Charity 1933
mapSeq(
  isMap,
  (no, scott) => isP("g0168", no, scott),
  stampsOf(isCat, "Postage stamps", "g0168").map((s) => s.no),
  ["B1", "B2", "B3", "B4"],
);

// Hopflug
mapSeq(
  isMap,
  (no, scott) => isP("g0172", no, scott),
  stampsOf(isCat, "Postage stamps", "g0172").map((s) => s.no),
  ["C12", "C13", "C14"],
);

// 1934 Airmail
mapSeq(
  isMap,
  (no, scott) => isP("g0175", no, scott),
  stampsOf(isCat, "Postage stamps", "g0175").map((s) => s.no),
  ["C15", "C16", "C17", "C18", "C19", "C20"],
);

isP("g0181", "0181", "193");
isP("g0181", "0182", "194");

// Jochumsson (SW last denom 35aur; Scott 198 is 25aur — map by set order)
mapSeq(
  isMap,
  (no, scott) => isP("g0183", no, scott),
  stampsOf(isCat, "Postage stamps", "g0183").map((s) => s.no),
  ["195", "196", "197", "198"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0187", no, scott),
  stampsOf(isCat, "Postage stamps", "g0187").map((s) => s.no),
  ["199", "200", "201"],
);
// g0190 same anniversary higher values — Facit airmail/related; leave unmapped if not Scott regulars

isP("g0193", "0193", "202");

// Geysir majors (SW order ≈ Scott 203-208)
mapSeq(
  isMap,
  (no, scott) => isP("g0194", no, scott),
  stampsOf(isCat, "Postage stamps", "g0194").map((s) => s.no),
  ["203", "204", "205", "206", "208A"],
);

// Leifr Eiríksson Day → Scott B5-B7 (1938 semi-postals)
mapSeq(
  isMap,
  (no, scott) => isP("g0199", no, scott),
  stampsOf(isCat, "Postage stamps", "g0199").map((s) => s.no),
  ["B5", "B6", "B7"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0202", no, scott),
  stampsOf(isCat, "Postage stamps", "g0202").map((s) => s.no),
  ["209", "210", "211"],
);

isP("g0205", "0205", "212");

mapSeq(
  isMap,
  (no, scott) => isP("g0206", no, scott),
  stampsOf(isCat, "Postage stamps", "g0206").map((s) => s.no),
  ["213", "214", "215", "216"],
);

// Fish definitives (partial SW set)
mapSeq(
  isMap,
  (no, scott) => isP("g0210", no, scott),
  stampsOf(isCat, "Postage stamps", "g0210").map((s) => s.no),
  ["217", "218", "219", "220", "221", "224"],
);

isP("g0216", "0216", "229"); // Thorfinn 2kr
isP("g0217", "0217", "228"); // Flag
isP("g0218", "0218", "208"); // Geysir 45aur

mapSeq(
  isMap,
  (no, scott) => isP("g0219", no, scott),
  stampsOf(isCat, "Postage stamps", "g0219").map((s) => s.no),
  ["232", "233", "234", "235"],
);

isP("g0223", "0223", "236"); // 25 on 3? — 1939-41 surcharge area; Scott 236 often Geysir-related

mapSeq(
  isMap,
  (no, scott) => isP("g0224", no, scott),
  stampsOf(isCat, "Postage stamps", "g0224").map((s) => s.no),
  ["243", "244", "245"],
);

// Extra values 1943 — Fish/Geysir/Thorfinn additions
{
  const sts = stampsOf(isCat, "Postage stamps", "g0227");
  const byDenom = {
    "12aur": "223",
    "35aur": "226",
    "50aur": "227",
    "60aur": "208B",
    "5Kr": "231",
  };
  for (const st of sts) {
    if (byDenom[st.denom]) isP("g0227", st.no, byDenom[st.denom]);
  }
}

mapSeq(
  isMap,
  (no, scott) => isP("g0232", no, scott),
  stampsOf(isCat, "Postage stamps", "g0232").map((s) => s.no),
  ["240", "241", "242", "237", "238", "239"],
);

// 1945 extras — fish redraws / karlsefni perfs (best-effort by denom)
{
  const sts = stampsOf(isCat, "Postage stamps", "g0238");
  const byDenom = {
    "10aur": "221a",
    "25aur": "224a",
    "1Kr": "238",
    "10Kr": "230",
  };
  for (const st of sts) {
    if (byDenom[st.denom]) isP("g0238", st.no, byDenom[st.denom]);
  }
}

mapSeq(
  isMap,
  (no, scott) => isP("g0242", no, scott),
  stampsOf(isCat, "Postage stamps", "g0242").map((s) => s.no),
  ["C21", "C22", "C23", "C24", "C25", "C26"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0248", no, scott),
  stampsOf(isCat, "Postage stamps", "g0248").map((s) => s.no),
  ["246", "247", "248", "249", "250", "251", "252"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0255", no, scott),
  stampsOf(isCat, "Postage stamps", "g0255").map((s) => s.no),
  ["B8", "B9", "B10", "B11"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0260", no, scott),
  stampsOf(isCat, "Postage stamps", "g0260").map((s) => s.no),
  ["253", "254", "255", "256"],
);

// 1950 Views & Occupations (8 of Scott 257-268)
mapSeq(
  isMap,
  (no, scott) => isP("g0264", no, scott),
  stampsOf(isCat, "Postage stamps", "g0264").map((s) => s.no),
  ["257", "258", "259", "260", "261", "262", "263", "264"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0272", no, scott),
  stampsOf(isCat, "Postage stamps", "g0272").map((s) => s.no),
  ["269", "270"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0274", no, scott),
  stampsOf(isCat, "Postage stamps", "g0274").map((s) => s.no),
  ["271", "272"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0276", no, scott),
  stampsOf(isCat, "Postage stamps", "g0276").map((s) => s.no),
  ["265", "266"],
);

isP("g0278", "0278", "273");

mapSeq(
  isMap,
  (no, scott) => isP("g0279", no, scott),
  stampsOf(isCat, "Postage stamps", "g0279").map((s) => s.no),
  ["C27", "C28", "C29"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0282", no, scott),
  stampsOf(isCat, "Postage stamps", "g0282").map((s) => s.no),
  ["274", "275", "276", "277"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0286", no, scott),
  stampsOf(isCat, "Postage stamps", "g0286").map((s) => s.no),
  ["B12", "B13"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0288", no, scott),
  stampsOf(isCat, "Postage stamps", "g0288").map((s) => s.no),
  ["278", "279", "280", "281", "282"],
);

isP("g0293", "0293", "283");

mapSeq(
  isMap,
  (no, scott) => isP("g0294", no, scott),
  stampsOf(isCat, "Postage stamps", "g0294").map((s) => s.no),
  ["284", "285", "286"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0297", no, scott),
  stampsOf(isCat, "Postage stamps", "g0297").map((s) => s.no),
  ["267", "268"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0299", no, scott),
  stampsOf(isCat, "Postage stamps", "g0299").map((s) => s.no),
  ["287", "288"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0301", no, scott),
  stampsOf(isCat, "Postage stamps", "g0301").map((s) => s.no),
  ["B14", "B15", "B16"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0304", no, scott),
  stampsOf(isCat, "Postage stamps", "g0304").map((s) => s.no),
  ["289", "290", "291", "292", "293", "294", "295", "296"],
);

isP("g0312", "0312", "297");

mapSeq(
  isMap,
  (no, scott) => isP("g0313", no, scott),
  stampsOf(isCat, "Postage stamps", "g0313").map((s) => s.no),
  ["298", "299"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0315", no, scott),
  stampsOf(isCat, "Postage stamps", "g0315").map((s) => s.no),
  ["300", "301"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0317", no, scott),
  stampsOf(isCat, "Postage stamps", "g0317").map((s) => s.no),
  ["302", "303", "304"],
);

isP("g0320", "0320", "305");

mapSeq(
  isMap,
  (no, scott) => isP("g0321", no, scott),
  stampsOf(isCat, "Postage stamps", "g0321").map((s) => s.no),
  ["306", "307"],
);

isP("g0323", "0323", "308");

mapSeq(
  isMap,
  (no, scott) => isP("g0324", no, scott),
  stampsOf(isCat, "Postage stamps", "g0324").map((s) => s.no),
  ["309", "310"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0326", no, scott),
  stampsOf(isCat, "Postage stamps", "g0326").map((s) => s.no),
  ["311", "312"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0328", no, scott),
  stampsOf(isCat, "Postage stamps", "g0328").map((s) => s.no),
  ["313", "314"],
);

mapSeq(
  isMap,
  (no, scott) => isP("g0330", no, scott),
  stampsOf(isCat, "Postage stamps", "g0330").map((s) => s.no),
  ["315", "316"],
);

// 1959-1960 (Jay Smith 317-332)
mapSeq(
  isMap,
  (no, scott) => isP("g0332", no, scott),
  stampsOf(isCat, "Postage stamps", "g0332").map((s) => s.no),
  ["317", "318"],
);
mapSeq(
  isMap,
  (no, scott) => isP("g0334", no, scott),
  stampsOf(isCat, "Postage stamps", "g0334").map((s) => s.no),
  ["C30", "C31"],
);
mapSeq(
  isMap,
  (no, scott) => isP("g0336", no, scott),
  stampsOf(isCat, "Postage stamps", "g0336").map((s) => s.no),
  ["319", "320", "321", "322"],
);
isP("g0340", "0340", "323");
mapSeq(
  isMap,
  (no, scott) => isP("g0341", no, scott),
  stampsOf(isCat, "Postage stamps", "g0341").map((s) => s.no),
  ["324", "325"],
);
isP("g0343", "0343", "326");
mapSeq(
  isMap,
  (no, scott) => isP("g0344", no, scott),
  stampsOf(isCat, "Postage stamps", "g0344").map((s) => s.no),
  ["327", "328"],
);
mapSeq(
  isMap,
  (no, scott) => isP("g0346", no, scott),
  stampsOf(isCat, "Postage stamps", "g0346").map((s) => s.no),
  ["329", "330"],
);

// 1961-1963 → Scott 333-358 (set-by-set in SW order within years)
{
  const blocks = [
    ["g0348", ["331", "332"]],
    ["g0350", ["333", "334", "335"]],
    ["g0353", ["336", "337"]],
    ["g0355", ["338", "339"]],
    ["g0357", ["340", "341", "342"]],
    ["g0360", ["343", "344"]],
    ["g0362", ["345", "346", "347"]],
    ["g0365", ["348", "349"]],
    ["g0367", ["350", "351"]],
    ["g0369", ["352", "353"]],
    ["g0371", ["354", "355"]],
    ["g0373", ["356"]],
    ["g0374", ["357", "358"]],
    ["g0376", ["B17", "B18"]],
  ];
  for (const [ref, scotts] of blocks) {
    mapSeq(
      isMap,
      (no, scott) => isP(ref, no, scott),
      stampsOf(isCat, "Postage stamps", ref).map((s) => s.no),
      scotts,
    );
  }
}

// 1964-1969 → Scott 359-411
{
  const blocks = [
    ["g0378", ["359"]],
    ["g0379", ["360", "361"]],
    ["g0381", ["362"]],
    ["g0382", ["363", "364", "365", "366"]],
    ["g0386", ["367", "368"]],
    ["g0388", ["369"]],
    ["g0389", ["B19", "B20"]],
    ["g0391", ["370", "371"]],
    ["g0393", ["372", "373", "374"]],
    ["g0396", ["375", "376"]],
    ["g0398", ["377"]],
    ["g0399", ["378"]],
    ["g0400", ["379"]],
    ["g0401", ["380", "381", "382", "383"]],
    ["g0405", ["384", "385"]],
    ["g0407", ["386", "387"]],
    ["g0409", ["388"]],
    ["g0410", ["389", "390"]],
    ["g0412", ["391"]],
    ["g0413", ["392"]],
    ["g0414", ["B21", "B22"]],
    ["g0416", ["393", "394"]],
    ["g0418", ["395", "396"]],
    ["g0420", ["397", "398"]],
    ["g0422", ["399"]],
    ["g0423", ["400", "401"]],
    ["g0425", ["402", "403"]],
    ["g0427", ["404", "405"]],
    ["g0429", ["406", "407"]],
    ["g0431", ["408", "409"]],
    ["g0433", ["410", "411"]],
  ];
  for (const [ref, scotts] of blocks) {
    mapSeq(
      isMap,
      (no, scott) => isP(ref, no, scott),
      stampsOf(isCat, "Postage stamps", ref).map((s) => s.no),
      scotts,
    );
  }
}

// 1970-1975 → Scott 412-488 (Jay Smith pages)
{
  const blocks = [
    ["g0435", ["412", "413", "414", "415"]],
    ["g0439", ["416"]],
    ["g0440", ["417", "418", "419"]],
    ["g0443", ["420", "421"]],
    ["g0445", ["422"]],
    ["g0446", ["423"]],
    ["g0447", ["424"]],
    ["g0448", ["425", "426"]],
    ["g0450", ["427"]],
    ["g0451", ["428"]],
    ["g0452", ["429", "430"]],
    ["g0454", ["431", "432"]],
    ["g0456", ["433", "434"]],
    ["g0458", ["435", "436", "437"]],
    ["g0461", ["438"]],
    ["g0462", ["439", "440"]],
    ["g0464", ["441"]],
    ["g0465", ["442"]],
    ["g0466", ["443", "444", "445"]],
    ["g0469", ["446"]],
    ["g0470", ["B23", "B24"]],
    ["g0472", ["447", "448"]],
    ["g0474", ["449", "450", "451", "452", "453"]],
    ["g0479", ["454", "455"]],
    ["g0481", ["456", "457"]],
    ["g0483", ["458", "459"]],
    ["g0485", ["460"]],
    ["g0486", ["461", "462", "463", "464"]],
    ["g0490", ["465", "466"]],
    ["g0492", ["467", "468", "469"]],
    ["g0495", ["470", "471", "472", "473"]],
    ["g0499", ["474", "475"]],
    ["g0501", ["476", "477"]],
    ["g0503", ["478", "479"]],
    ["g0505", ["480"]],
    ["g0506", ["481", "482", "483", "484"]],
    ["g0510", ["485"]],
    ["g0511", ["486"]],
    ["g0512", ["487"]],
    ["g0513", ["488"]],
  ];
  for (const [ref, scotts] of blocks) {
    mapSeq(
      isMap,
      (no, scott) => isP(ref, no, scott),
      stampsOf(isCat, "Postage stamps", ref).map((s) => s.no),
      scotts,
    );
  }
}

// 1976-1982 → Scott 489-566
{
  const blocks = [
    ["g0514", ["489"]],
    ["g0515", ["490", "491"]],
    ["g0517", ["492", "493"]],
    ["g0519", ["494"]],
    ["g0520", ["495"]],
    ["g0521", ["496", "497"]],
    ["g0523", ["498", "499"]],
    ["g0525", ["500"]],
    ["g0526", ["501"]],
    ["g0527", ["502"]],
    ["g0528", ["503"]],
    ["g0529", ["504", "505"]],
    ["g0531", ["506", "507"]],
    ["g0533", ["508", "509"]],
    ["g0535", ["510"]],
    ["g0536", ["511"]],
    ["g0537", ["512"]],
    ["g0538", ["513"]],
    ["g0539", ["514"]],
    ["g0540", ["515", "516"]],
    ["g0542", ["517", "518"]],
    ["g0544", ["519"]],
    ["g0545", ["520"]],
    ["g0546", ["521"]],
    ["g0547", ["522"]],
    ["g0548", ["523", "524", "525"]],
    ["g0551", ["526", "527"]],
    ["g0553", ["528", "529"]],
    ["g0555", ["530"]],
    ["g0556", ["531"]],
    ["g0557", ["532", "533"]],
    ["g0559", ["534", "535", "536"]],
    ["g0562", ["537"]],
    ["g0563", ["538"]],
    ["g0564", ["539", "540"]],
    ["g0566", ["541", "542"]],
    ["g0568", ["543", "544", "545"]],
    ["g0571", ["546"]],
    ["g0572", ["547"]],
    ["g0573", ["548"]],
    ["g0574", ["549"]],
    ["g0575", ["550", "551"]],
    ["g0577", ["552", "553"]],
    ["g0579", ["554", "555"]],
    ["g0581", ["556", "557", "558"]],
    ["g0584", ["559"]],
    ["g0585", ["560"]],
    ["g0586", ["561"]],
    ["g0587", ["562"]],
    ["g0588", ["563"]],
    ["g0589", ["564", "565"]],
    ["g0591", ["566", "567"]],
  ];
  for (const [ref, scotts] of blocks) {
    mapSeq(
      isMap,
      (no, scott) => isP(ref, no, scott),
      stampsOf(isCat, "Postage stamps", ref).map((s) => s.no),
      scotts,
    );
  }
}

// 1983–1990 commemoratives (sequential within Jay Smith year blocks; inferred).
{
  const blocks = [
    ["g0593", ["568", "569", "570", "571"]],
    ["g0597", ["572", "573"]],
    ["g0599", ["574", "575"]],
    ["g0601", ["576", "577"]],
    ["g0603", ["578"]],
    ["g0604", ["579", "580"]],
    ["g0606", ["581"]],
    ["g0607", ["582", "583"]],
    ["g0609", ["584", "585"]],
    ["g0611", ["586", "587"]],
    ["g0613", ["588", "589"]],
    ["g0615", ["590", "591"]],
    ["g0617", ["592"]],
    ["g0618", ["593"]],
    ["g0619", ["594"]],
    ["g0620", ["595", "596"]],
    ["g0622", ["597"]],
    ["g0623", ["598", "599"]],
    ["g0625", ["600", "601"]],
    ["g0627", ["602", "603"]],
    ["g0629", ["604", "605", "606", "607"]],
    ["g0633", ["608", "609"]],
    ["g0635", ["610"]],
    ["g0636", ["611"]],
    ["g0637", ["612", "613", "614"]],
    ["g0640", ["615", "616"]],
    ["g0642", ["617"]],
    ["g0643", ["618", "619"]],
    ["g0645", ["620", "621", "622", "623"]],
    ["g0649", ["624", "625"]],
    ["g0651", ["626", "627"]],
    ["g0653", ["628", "629"]],
    ["g0655", ["630", "631", "632", "633"]],
    ["g0659", ["634", "635"]],
    ["g0661", ["636"]],
    ["g0662", ["637", "638"]],
    ["g0664", ["639"]],
    ["g0665", ["640"]],
    ["g0666", ["641", "642"]],
    ["g0668", ["643"]],
    ["g0669", ["644", "645", "646", "647"]],
    ["g0673", ["648"]],
    ["g0674", ["649", "650", "651", "652"]],
    ["g0678", ["653"]],
    ["g0679", ["654", "655"]],
    ["g0681", ["656", "657"]],
    ["g0683", ["658", "659"]],
    ["g0685", ["660", "661", "662", "663"]],
    ["g0689", ["664", "665"]],
    ["g0691", ["666"]],
    ["g0692", ["667", "668"]],
    ["g0694", ["669"]],
    ["g0695", ["670"]],
    ["g0696", ["671", "672"]],
    ["g0698", ["673", "674"]],
    ["g0700", ["675", "676"]],
    ["g0702", ["677", "678"]],
    ["g0704", ["679"]],
    ["g0705", ["680"]],
    ["g0706", ["681", "682"]],
    ["g0708", ["683", "684", "685"]],
    ["g0711", ["686", "687"]],
    ["g0713", ["688", "689"]],
    ["g0715", ["690", "691"]],
    ["g0717", ["692", "693", "694", "695"]],
    ["g0721", ["696", "697", "698", "699"]],
    ["g0725", ["700", "701"]],
    ["g0727", ["702", "703"]],
    ["g0729", ["704", "705"]],
    ["g0731", ["706", "707"]],
    ["g0733", ["708"]],
    ["g0734", ["709", "710", "711"]],
    ["g0737", ["712", "713"]],
  ];
  for (const [ref, scotts] of blocks) {
    mapSeq(
      isMap,
      (no, scott) => isP(ref, no, scott),
      stampsOf(isCat, "Postage stamps", ref).map((s) => s.no),
      scotts,
    );
  }
}

isDoc.mappings = isMap;
isDoc.version = 2;
isDoc.sources = [
  ...new Set([
    ...(isDoc.sources || []),
    "https://www.jaysmith.com/Lists/Iceland/IcelandTOC.html",
    "https://www.mostlyclassics.net/philatelic/Iceland_1873-1944_nopix.pdf",
    "https://www.birdtheme.org/country/iceland.html",
  ]),
];
fs.writeFileSync(isPath, `${JSON.stringify(isDoc, null, 2)}\n`);
console.log(
  `Iceland: ${beforeIs} → ${Object.keys(isMap).length} mappings (+${Object.keys(isMap).length - beforeIs})`,
);

// ---------- Denmark ----------
const dkPath = path.join(ROOT, "catalogs/scott/denmark.json");
const dkDoc = JSON.parse(fs.readFileSync(dkPath, "utf8"));
const dkMap = { ...dkDoc.mappings };
const beforeDk = Object.keys(dkMap).length;

const dkP = (no, scott, rel, st) => putDk(dkMap, "Postage stamps", no, scott, rel, st);

// 1921 8øre surcharges (HipStamp: Scott 161 = 8 on 7)
dkP("0118", "160");
dkP("0119", "161");
dkP("0120", "162");

// Reunion Red Cross surcharges → Scott B1-B2
dkP("0121", "B1");
dkP("0122", "B2");

// 1921 Wavy Lines
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0123").map((s) => s.no),
  ["156", "157", "158"],
);

// 1921-22 Christian X (Jay Smith 122-131 / 145-154 era; SW≈AFA offset)
{
  const sts = stampsOf(dkCat, "Postage stamps", "g0126");
  // Common Scott majors for these denoms (crosses wm Christian X):
  const byDenom = {
    "20Øre": "150",
    "25Øre": "151",
    "30Øre": "152",
    "40Øre": "153",
    "50Øre": "154",
    "60Øre": "163",
    "1Kr": "131",
  };
  const shade50 = [];
  for (const st of sts) {
    if (st.denom === "50Øre") {
      shade50.push(st);
      continue;
    }
    if (byDenom[st.denom]) dkP(st.no, byDenom[st.denom], /a$/i.test(st.no) ? "shade" : "exact");
  }
  if (shade50[0]) dkP(shade50[0].no, "154");
  if (shade50[1]) dkP(shade50[1].no, "154", "shade");
}

// 1924 Postal Service 300th — Pressdat Scott 164-175
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  [
    ...stampsOf(dkCat, "Postage stamps", "g0133"),
    ...stampsOf(dkCat, "Postage stamps", "g0137"),
    ...stampsOf(dkCat, "Postage stamps", "g0141"),
  ].map((s) => s.no),
  [
    "164", "165", "166", "167",
    "168", "169", "170", "171",
    "172", "173", "174", "175",
  ],
);

// 1925 Airmail (Scott C1-C3; SW lists 20øre for third — treat as C3/25)
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0145").map((s) => s.no),
  ["C1", "C2", "C3"],
);

// 1925-26 Christian X new colours
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0148").map((s) => s.no),
  ["176", "177", "181", "182", "129"],
);

dkP("0153", "183");
dkP("0154", "184");

mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0155").map((s) => s.no),
  ["178", "179", "180"],
);

mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0158").map((s) => s.no),
  ["185", "190", "191"],
);

// Official surcharges 7øre → Scott 186-189 area (Jay Smith)
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0161").map((s) => s.no),
  ["186", "187", "188", "189", "192", "193", "194"],
);

mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0168").map((s) => s.no),
  ["195", "196"],
);

// Caravel typographed 1927
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0170").map((s) => s.no),
  ["197", "198", "199", "200", "201", "202"],
);

dkP("0176", "203");
dkP("0177", "130"); // 5kr Christian X
dkP("0178", "131"); // 10kr — may collide with earlier 1kr map; 1928 10kr is Scott 131 in some lists
// Fix: Jay Smith lists Scott 129=2kr, 130/131 high values. Keep 0177→130, 0178→131 only if not already used for 1kr.
// Re-map 1Kr from g0126 carefully: common Scott for 1kr 1922 is 128.
dkP("0132", "128");
dkP("0177", "130");
dkP("0178", "131");

mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0179").map((s) => s.no),
  ["B3", "B4", "B5"],
);

mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0182").map((s) => s.no),
  ["C4", "C5"],
);

mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0184").map((s) => s.no),
  ["204", "205", "206"],
);

mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0187").map((s) => s.no),
  ["210", "211", "212", "213", "214", "215", "216", "217", "218", "219"],
);

// 1933 engraved wavy / caravel
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0197").map((s) => s.no),
  ["220", "221", "222", "223", "224", "225", "226"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0204").map((s) => s.no),
  ["227", "228", "229", "230", "231", "232"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0210").map((s) => s.no),
  ["233", "234", "235", "236", "237"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0215").map((s) => s.no),
  ["238", "238A"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0217").map((s) => s.no),
  ["C6", "C7", "C8", "C9", "C10"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0222").map((s) => s.no),
  ["239", "240"],
);

// Commemoratives 1935-1945
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0224").map((s) => s.no),
  ["246", "247", "248", "249", "250", "251"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0230").map((s) => s.no),
  ["252", "253", "254", "255", "256"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0235").map((s) => s.no),
  ["257", "258"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0237").map((s) => s.no),
  ["B6", "B7", "B8"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0240").map((s) => s.no),
  ["259", "260", "261", "262"],
);
dkP("0244", "263");
dkP("0245", "264");
dkP("0246", "265");
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0247").map((s) => s.no),
  ["266", "266", "267", "268"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0250").map((s) => s.no),
  ["269", "270", "271"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0253").map((s) => s.no),
  ["B9", "B10"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0255").map((s) => s.no),
  ["272", "273", "274"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0258").map((s) => s.no),
  ["275", "275", "276", "277", "278"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0262").map((s) => s.no),
  ["279", "280"],
);
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0264").map((s) => s.no),
  ["281", "281", "282", "282", "283"],
);
dkP("0267", "284");
dkP("0268", "B11");
dkP("0269", "B12");
dkP("0270", "285");
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0271").map((s) => s.no),
  ["286", "287", "288"],
);
dkP("0274", "289");
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0275").map((s) => s.no),
  ["290", "290", "291", "292", "293", "294", "295"],
);
dkP("0282", "B13");
dkP("0283", "297");
dkP("0284", "B14");
dkP("0285", "298");
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0286").map((s) => s.no),
  ["299", "300", "301"],
);
dkP("0289", "302");
dkP("0290", "303");
mapSeq(
  dkMap,
  (no, scott) => dkP(no, scott),
  stampsOf(dkCat, "Postage stamps", "g0291").map((s) => s.no),
  ["304", "305", "306"],
);

dkDoc.mappings = dkMap;
dkDoc.version = 2;
dkDoc.sources = [
  ...new Set([
    ...(dkDoc.sources || []),
    "https://www.jaysmith.com/Lists/Denmark/DenmarkTOC.html",
    "https://pressdat.com/300th-anniversary-danish-postal-service/",
    "https://www.hipstamp.com/listing/1922-denmark-161-8o-on-7o-surcharge-king-christian-x-used/52664115",
  ]),
];
fs.writeFileSync(dkPath, `${JSON.stringify(dkDoc, null, 2)}\n`);
console.log(
  `Denmark: ${beforeDk} → ${Object.keys(dkMap).length} mappings (+${Object.keys(dkMap).length - beforeDk})`,
);
