const express = require("express");
const axios   = require("axios");

const app  = express();
const PORT = process.env.PORT || 3000;

const API =
  "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=2cff2322cadccdcb7afd52aa2f828f83";

const HEADERS = {
  "accept":          "*/*",
  "accept-language": "vi-VN,vi;q=0.9",
  "cache-control":   "no-cache",
  "pragma":          "no-cache",
  "referer":         "https://tele68.com/",
  "origin":          "https://tele68.com",
  "user-agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile Safari/604.1",
};

/* =========================
   PARSE XUC XAC
========================= */

function tryParseString(str) {
  if (!str) return null;
  const s = String(str).trim();
  const parts = s.split(/[\s,\-|\/\\]+/).map(Number).filter((n) => n >= 1 && n <= 6);
  if (parts.length >= 3) return parts.slice(0, 3);
  if (/^\d{3}$/.test(s)) {
    const p = s.split("").map(Number);
    if (p.every((n) => n >= 1 && n <= 6)) return p;
  }
  return null;
}

function parseDices(item) {
  // 1. Ba field rieng
  const K1 = ["d1","dice1","x1","v1","num1","n1","open1","s1","p1","point1","openNum1","ball1","b1","red1"];
  const K2 = ["d2","dice2","x2","v2","num2","n2","open2","s2","p2","point2","openNum2","ball2","b2","red2"];
  const K3 = ["d3","dice3","x3","v3","num3","n3","open3","s3","p3","point3","openNum3","ball3","b3","red3"];
  const f  = (keys) => { for (const k of keys) { const v = Number(item[k]); if (v >= 1 && v <= 6) return v; } return null; };
  const d1 = f(K1), d2 = f(K2), d3 = f(K3);
  if (d1 && d2 && d3) return [d1, d2, d3];

  // 2. Field gop string/array
  const COMBO = [
    "openCode","open_code","openNum","open_num","dices","dice",
    "nums","num","number","numbers","result_num","resultNum",
    "point","points","values","balls","ball","xucxac","xuc_xac",
    "code","resultCode","result_code","open","openResult","open_result",
    "content","detail","info","val","value","combination","answer",
  ];
  for (const k of COMBO) {
    const val = item[k];
    if (val == null) continue;
    if (Array.isArray(val)) {
      const p = val.map(Number).filter((n) => n >= 1 && n <= 6);
      if (p.length >= 3) return p.slice(0, 3);
    }
    const parsed = tryParseString(val);
    if (parsed) return parsed;
  }

  // 3. Duyet tat ca keys
  for (const k in item) {
    const val = item[k];
    if (Array.isArray(val) && val.length >= 3) {
      const p = val.map(Number).filter((n) => n >= 1 && n <= 6);
      if (p.length >= 3) return p.slice(0, 3);
    }
    if (typeof val === "string") {
      const parsed = tryParseString(val);
      if (parsed) return parsed;
    }
  }
  return null;
}

function parseSession(item) {
  const KEYS = [
    "session","issue","sid","expect","round","no","phien","period",
    "periodId","period_id","roundId","round_id","issue_no","issueNo",
    "drawNo","draw_no","turnNo","turn_no","gameNo","game_no","seq","sequence",
  ];
  for (const k of KEYS) {
    const v = item[k];
    if (v != null && v !== "" && Number(v) !== 0) return v;
  }
  for (const k in item) {
    const v = item[k];
    if (typeof v === "number" && v > 10000) return v;
    if (typeof v === "string" && /^\d{5,}$/.test(v.trim())) return v.trim();
  }
  // fallback: lay id
  return item.id || "?";
}

function parseTotal(item, dicesTotal) {
  if (dicesTotal && dicesTotal !== 3) return dicesTotal;
  const KEYS = ["total","sum","point","points","score","tong","totalPoint","total_point","openTotal","open_total","sumPoint"];
  for (const k of KEYS) { const v = Number(item[k]); if (v >= 3 && v <= 18) return v; }
  return dicesTotal;
}

function parseResultDirect(item) {
  const KEYS = ["result","ketqua","ket_qua","type","side","win","outcome","gameResult","game_result","openResult","open_result","rs","txResult","tx_result"];
  for (const k of KEYS) {
    const v = String(item[k] || "").toLowerCase().trim();
    if (v.includes("t\u00e0i") || v.includes("tai") || v==="big"||v==="t"||v==="1"||v==="over") return "t\u00e0i";
    if (v.includes("x\u1ec9u") || v.includes("xiu") || v==="small"||v==="x"||v==="0"||v==="under") return "x\u1ec9u";
  }
  return null;
}

/* =========================
   TAI / XIU
========================= */

function getResult(total) { return total >= 11 ? "t\u00e0i" : "x\u1ec9u"; }

/* =========================
   NHAN DIEN CAU
========================= */

function toSymbols(history) { return history.map((h) => (h.result === "t\u00e0i" ? "T" : "X")); }

function getCurrentStreak(symbols) {
  if (!symbols.length) return { type: null, count: 0 };
  const last = symbols[symbols.length - 1];
  let count = 0;
  for (let i = symbols.length - 1; i >= 0; i--) { if (symbols[i]===last) count++; else break; }
  return { type: last==="T" ? "t\u00e0i" : "x\u1ec9u", count };
}

function toBlocks(arr) {
  if (!arr.length) return [];
  const blocks = []; let cur = { val: arr[0], len: 1 };
  for (let i = 1; i < arr.length; i++) { if (arr[i]===cur.val) cur.len++; else { blocks.push(cur); cur={val:arr[i],len:1}; } }
  blocks.push(cur); return blocks;
}

function detectPattern(history) {
  if (history.length < 4)
    return { pattern:"ch\u01b0a \u0111\u1ee7 d\u1eef li\u1ec7u", description:"C\u1ea7n th\u00eam phi\u00ean", confidence:50, nextPrediction:null };

  const syms   = toSymbols(history);
  const recent = syms.slice(-12);

  if (recent.every((s) => s===recent[0])) {
    const streak = getCurrentStreak(syms);
    return {
      pattern:`c\u1ea7u b\u1ec7t ${streak.type} (${streak.count} phi\u00ean)`,
      description:`\u0110ang b\u1ec7t ${streak.type} li\u00ean ti\u1ebfp ${streak.count} phi\u00ean`,
      confidence: streak.count>=5?60:75,
      nextPrediction: streak.count>=5?(streak.type==="t\u00e0i"?"x\u1ec9u":"t\u00e0i"):streak.type,
    };
  }

  const last8 = recent.slice(-8);
  let isAlt = last8.length >= 6;
  for (let i=1; i<last8.length; i++) { if (last8[i]===last8[i-1]) { isAlt=false; break; } }
  if (isAlt) return { pattern:"c\u1ea7u 1-1 (xen k\u1ebd)", description:"T\u00e0i X\u1ec9u \u0111an xen \u0111\u1ec1u \u0111\u1eb7n", confidence:82,
                      nextPrediction: last8[last8.length-1]==="T"?"x\u1ec9u":"t\u00e0i" };

  const blocks = toBlocks(recent);
  if (blocks.length >= 4) {
    const lens = blocks.slice(-4).map((b) => b.len);
    const last = blocks[blocks.length - 1];
    const flip = last.val==="T"?"x\u1ec9u":"t\u00e0i";
    const cont = last.val==="T"?"t\u00e0i":"x\u1ec9u";

    if (lens.every((l)=>l===2)) return { pattern:"c\u1ea7u 2-2", description:"C\u1eb7p 2 xen k\u1ebd", confidence:80, nextPrediction:flip };
    if (lens.every((l)=>l===3)) return { pattern:"c\u1ea7u 3-3", description:"Nh\u00f3m 3 xen k\u1ebd", confidence:78, nextPrediction:flip };
    if (lens.every((l)=>l===3||l===4)) return { pattern:"c\u1ea7u 3-4", description:"Nh\u00f3m 3-4 xen k\u1ebd", confidence:72, nextPrediction: last.len>=3?flip:cont };
    if (lens[0]===1&&lens[1]===2&&lens[2]===1&&lens[3]===2) return { pattern:"c\u1ea7u 1-2", description:"\u0110\u01a1n r\u1ed3i c\u1eb7p xen k\u1ebd", confidence:72, nextPrediction:flip };
    if (lens[0]===2&&lens[1]===1&&lens[2]===2&&lens[3]===1) return { pattern:"c\u1ea7u 2-1", description:"C\u1eb7p r\u1ed3i \u0111\u01a1n xen k\u1ebd", confidence:72, nextPrediction: last.len>=2?flip:cont };
    if (lens.every((l)=>l===1||l===2)) return { pattern:"c\u1ea7u 2-1", description:"Xen k\u1ebd c\u1eb7p v\u00e0 \u0111\u01a1n", confidence:68, nextPrediction: last.len>=2?flip:cont };
  }

  const streak = getCurrentStreak(syms);
  if (streak.count >= 2) return { pattern:`c\u1ea7u b\u1ec7t nh\u1eb9 (${streak.count} phi\u00ean)`, description:`${streak.type} ch\u1ea1y ${streak.count} phi\u00ean`, confidence:62, nextPrediction:streak.type };
  return { pattern:"c\u1ea7u ng\u1eabu nhi\u00ean", description:"Kh\u00f4ng c\u00f3 pattern r\u00f5 r\u00e0ng", confidence:52, nextPrediction:null };
}

/* =========================
   PHAN TICH XUC XAC
========================= */

function diceAnalysis(history) {
  const valid = history.filter((h) => h.hasRealDice);
  const src   = valid.length >= 3 ? valid : history;
  if (src.length < 3) return { prediction:null, confidence:50, note:"Ch\u01b0a \u0111\u1ee7 d\u1eef li\u1ec7u", avgTotal:"?" };

  const recent   = src.slice(-5);
  const avgTotal = recent.reduce((s,h) => s+h.total, 0) / recent.length;
  const last     = src[src.length - 1];

  const isTriplet   = last.hasRealDice && last.dices[0]===last.dices[1] && last.dices[1]===last.dices[2];
  const isEvenTotal = last.total % 2 === 0;
  const isHighDice  = last.hasRealDice && last.dices.every((d) => d >= 4);
  const isLowDice   = last.hasRealDice && last.dices.every((d) => d <= 3);

  let note=[], score=0;
  if (isTriplet)   { note.push(`B\u1ed9 ba ${last.dices[0]}-${last.dices[0]}-${last.dices[0]} => th\u01b0\u1eddng \u0111\u1ea3o chi\u1ec1u`); score += last.result==="t\u00e0i"?-30:30; }
  if (avgTotal>10.5){ note.push(`TB ${avgTotal.toFixed(1)} > 10.5 => ngh\u00ecng t\u00e0i`);  score+=15; }
  else              { note.push(`TB ${avgTotal.toFixed(1)} \u2264 10.5 => ngh\u00ecng x\u1ec9u`); score-=15; }
  if (isHighDice)   { note.push("C\u1ea3 3 x\u00fac x\u1eafc cao (\u22654) => ngh\u00ecng t\u00e0i");  score+=20; }
  if (isLowDice)    { note.push("C\u1ea3 3 x\u00fac x\u1eafc th\u1ea5p (\u22643) => ngh\u00ecng x\u1ec9u"); score-=20; }
  if (isEvenTotal)  { note.push("T\u1ed5ng ch\u1eb5n => ngh\u00ecng l\u1ebb ti\u1ebfp");  score-=5; }
  else              { note.push("T\u1ed5ng l\u1ebb => ngh\u00ecng ch\u1eb5n ti\u1ebfp"); score+=5; }

  return {
    prediction: score>=0?"t\u00e0i":"x\u1ec9u",
    confidence: Math.floor(Math.min(85, 50+Math.abs(score)/2)),
    note:       note.join(" | "),
    avgTotal:   avgTotal.toFixed(1),
    isTriplet,
  };
}

/* =========================
   THUAT TOAN GOC
========================= */

function trendPredict(h) {
  let t=0,x=0; h.slice(-10).forEach((i)=>{if(i.result==="t\u00e0i")t++;else x++;});
  return t>x?{prediction:"x\u1ec9u",confidence:70}:{prediction:"t\u00e0i",confidence:70};
}
function streakPredict(h) {
  const last=h[h.length-1]; let s=1;
  for(let i=h.length-2;i>=0;i--){if(h[i].result===last.result)s++;else break;}
  return s>=3?{prediction:last.result==="t\u00e0i"?"x\u1ec9u":"t\u00e0i",confidence:85}:{prediction:last.result,confidence:60};
}
function markovPredict(h) {
  if(h.length<5)return{prediction:"t\u00e0i",confidence:50};
  const last=h[h.length-1].result; let same=0,chg=0;
  for(let i=1;i<h.length;i++){if(h[i-1].result===last){if(h[i].result===last)same++;else chg++;}}
  return chg>same?{prediction:last==="t\u00e0i"?"x\u1ec9u":"t\u00e0i",confidence:75}:{prediction:last,confidence:75};
}

function superPredict(history) {
  const algos=[trendPredict(history),streakPredict(history),markovPredict(history)];
  const pi=detectPattern(history);  if(pi.nextPrediction) algos.push({prediction:pi.nextPrediction,confidence:pi.confidence});
  const di=diceAnalysis(history);   if(di.prediction)     algos.push({prediction:di.prediction,    confidence:di.confidence});
  let t=0,x=0; algos.forEach((a)=>{if(a.prediction==="t\u00e0i")t+=a.confidence;else x+=a.confidence;});
  const conf=Math.min(Math.floor((Math.max(t,x)/(t+x))*100),95);
  return{prediction:t>x?"t\u00e0i":"x\u1ec9u",confidence:conf,patternInfo:pi,diceInfo:di};
}

/* =========================
   LOAD DATA
========================= */

async function fetchRaw() {
  const res=await axios({method:"GET",url:API,timeout:10000,headers:HEADERS});
  return res.data;
}

function extractArray(raw) {
  if(Array.isArray(raw)&&raw.length) return raw;
  if(raw&&typeof raw==="object") {
    const pri=["data","list","records","rows","items","result","results","history","sessions","issues","periods","content","array"];
    for(const k of pri){if(Array.isArray(raw[k])&&raw[k].length)return raw[k];}
    for(const k in raw){if(Array.isArray(raw[k])&&raw[k].length)return raw[k];}
    for(const k in raw){
      if(raw[k]&&typeof raw[k]==="object"&&!Array.isArray(raw[k])){
        for(const k2 in raw[k]){if(Array.isArray(raw[k][k2])&&raw[k][k2].length)return raw[k][k2];}
      }
    }
  }
  return [];
}

async function getData() {
  try {
    const raw=await fetchRaw();
    console.log("RAW SAMPLE:", JSON.stringify(raw).slice(0,2000));
    const arr=extractArray(raw);
    if(!arr.length){ console.log("No array. Keys:", Object.keys(raw||{})); return []; }
    console.log(`Found ${arr.length} items. item[0]:`, JSON.stringify(arr[0]).slice(0,400));

    const mapped = arr.map((item) => {
      const dices       = parseDices(item);
      const session     = parseSession(item);
      const hasRealDice = dices !== null;
      const [d1,d2,d3]  = dices||[1,1,1];
      const rawTotal    = d1+d2+d3;
      const total       = parseTotal(item,rawTotal);
      const direct      = parseResultDirect(item);
      const result      = direct || getResult(total);
      return{id:"s2king",session,dices:[d1,d2,d3],total,result,hasRealDice};
    });

    // Xac dinh thu tu: neu session[0] > session[1] thi API tra moi nhat truoc => can reverse
    // de history[last] luon la phien moi nhat
    if (mapped.length >= 2) {
      const s0 = Number(mapped[0].session);
      const s1 = Number(mapped[mapped.length - 1].session);
      if (s0 > s1) {
        mapped.reverse();
        console.log("Array reversed: API tra moi nhat truoc, da dao nguoc de [last]=moi nhat");
      }
    }

    return mapped;
  } catch(err) {
    console.log("ERROR:", err.response?.data||err.message); return [];
  }
}

/* =========================
   ROUTES
========================= */

app.get("/", async(req,res) => {
  const history=await getData();
  if(!history.length) return res.send("Khong lay duoc du lieu\nVao /debug de kiem tra cau truc API.");

  const noDice = history.filter((h)=>!h.hasRealDice).length;
  const warn   = noDice===history.length
    ? "\n[!] API khong tra ve xuc xac â chi du doan tu ket qua tai/xiu. Xem /debug\n"
    : "";

  const last    = history[history.length-1];
  const predict = superPredict(history);
  const streak  = getCurrentStreak(toSymbols(history));

  const diceStr = last.hasRealDice ? last.dices.join("-") : "N/A";
  const tongStr = last.hasRealDice ? last.total : "N/A";

  res.send(
`Id: s2king
Phien:${last.session}
Ket_qua:${last.result}
Xuc_xac:${diceStr}
Tong:${tongStr}
Phien_hien_tai:${Number(last.session)+1}
${warn}
--- CAU DANG CHAY ---
Loai_cau:${predict.patternInfo.pattern}
Mo_ta:${predict.patternInfo.description}
Bet_hien_tai:${streak.type} x${streak.count} phien

--- PHAN_TICH_XUC_XAC ---
Tong_TB_5_phien:${predict.diceInfo.avgTotal}
Chi_tiet:${predict.diceInfo.note}

--- DU DOAN ---
Du_doan:${predict.prediction}
Do_tin_cay:${predict.confidence}%`
  );
});

// DEBUG: xem cau truc JSON that te
app.get("/debug", async(req,res) => {
  try {
    const raw=await fetchRaw();
    const arr=extractArray(raw);
    res.json({
      topLevelKeys: Object.keys(raw||{}),
      arrayLength:  arr.length,
      item0: arr[0]||null,
      item1: arr[1]||null,
      item2: arr[2]||null,
    });
  } catch(err) {
    res.json({error:err.message,detail:err.response?.data});
  }
});

app.listen(PORT, ()=>console.log("Server chay cong", PORT));
