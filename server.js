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

/* =======================================================
   NHAN DIEN CAU - THUAT TOAN NANG CAP
   Logic chinh:
   1. Tach lich su thanh cac block lien tiep
   2. Nhan dien kieu cau TU LICH SU block (can 2+ chu ky)
   3. Tinh xac suat cau van tiep hay gay
   4. Du doan cau TIEP THEO khi cau hien tai gay
   5. Tra ve: cau hien tai, trang thai, du doan, ly do ro rang
======================================================= */

function toSymbols(history) { return history.map((h) => (h.result === "tài" ? "T" : "X")); }

function toBlocks(arr) {
  if (!arr.length) return [];
  const blocks = []; let cur = { val: arr[0], len: 1 };
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === cur.val) cur.len++;
    else { blocks.push(cur); cur = { val: arr[i], len: 1 }; }
  }
  blocks.push(cur);
  return blocks;
}

function getCurrentStreak(symbols) {
  if (!symbols.length) return { type: null, count: 0 };
  const last = symbols[symbols.length - 1];
  let count = 0;
  for (let i = symbols.length - 1; i >= 0; i--) { if (symbols[i] === last) count++; else break; }
  return { type: last === "T" ? "tài" : "xỉu", count };
}

function flip(val) { return val === "T" ? "xỉu" : "tài"; }
function cont(val) { return val === "T" ? "tài" : "xỉu"; }

/* ---------- Nhan dien kieu cau tu block history ---------- */
function classifyBlocks(blocks) {
  if (blocks.length < 2) return null;

  const lens = blocks.map(b => b.len);
  const n    = lens.length;

  // ---- Bet: tat ca block dai >= 4, chi 1 gia tri thay doi it
  // Thuc ra "bet" khi block hien tai >= 4 va lich su block cung dai
  const avgLen = lens.reduce((a,b)=>a+b,0)/n;

  // Kiem tra pattern lap lai trong cac block gan nhat
  // So sanh do lech chuan de biet cau co on dinh khong
  const recentLens = lens.slice(-6);
  const meanLen    = recentLens.reduce((a,b)=>a+b,0)/recentLens.length;
  const stdLen     = Math.sqrt(recentLens.reduce((s,l)=>s+Math.pow(l-meanLen,2),0)/recentLens.length);

  // Cau 1-1: tat ca block dai 1
  if (recentLens.every(l=>l===1)) return { type:"1-1", cycleLen:1, confirmed: n>=6 };

  // Cau 2-2: tat ca block dai 2
  if (recentLens.every(l=>l===2)) return { type:"2-2", cycleLen:2, confirmed: n>=4 };

  // Cau 3-3: tat ca block dai 3
  if (recentLens.every(l=>l===3)) return { type:"3-3", cycleLen:3, confirmed: n>=4 };

  // Cau 4-4: tat ca block dai 4
  if (recentLens.every(l=>l===4)) return { type:"4-4", cycleLen:4, confirmed: n>=3 };

  // Cau 2-1 hoac 1-2: xen ke 2 va 1
  if (recentLens.every(l=>l===1||l===2)) {
    const pattern = recentLens.slice(-4).join("-");
    return { type:"2-1", cycleLen:2, confirmed: n>=5, pattern };
  }

  // Cau 3-1 hoac 1-3
  if (recentLens.every(l=>l===1||l===3)) return { type:"3-1", cycleLen:3, confirmed: n>=4 };

  // Cau 3-2 hoac 2-3
  if (recentLens.every(l=>l===2||l===3)) return { type:"3-2", cycleLen:3, confirmed: n>=4 };

  // Cau bet dai (block hien tai >= 5, lich su cung co block dai)
  if (avgLen >= 3.5 && stdLen <= 1.5) return { type:`bet-${Math.round(avgLen)}`, cycleLen:Math.round(avgLen), confirmed: n>=3 };

  // Cau khong ro
  return { type:"random", cycleLen:0, confirmed: false };
}

/* ---------- Tinh xac suat cau gay dua tren lich su ---------- */
function calcBreakProb(blocks, cauType) {
  if (blocks.length < 4) return 0.3;

  const curBlock = blocks[blocks.length - 1];
  const curLen   = curBlock.len;

  // Lay tat ca block cung gia tri de tinh phan phoi do dai
  const sameValBlocks = blocks.slice(0,-1).filter(b => b.val === curBlock.val).map(b => b.len);
  if (!sameValBlocks.length) return 0.3;

  const avgBlockLen = sameValBlocks.reduce((a,b)=>a+b,0) / sameValBlocks.length;
  const maxBlockLen = Math.max(...sameValBlocks);

  // Xac suat gay tang khi block hien tai qua dai so voi trung binh
  if (curLen >= maxBlockLen)       return 0.80; // da qua max lich su => rat co the gay
  if (curLen >= avgBlockLen * 1.5) return 0.70;
  if (curLen >= avgBlockLen)       return 0.55;
  if (curLen >= avgBlockLen * 0.8) return 0.40;
  return 0.25; // con ngan, nhieu kha nang tiep tuc
}

/* ---------- Du doan cau tiep theo se la gi sau khi gay ---------- */
function predictNextPattern(blocks, cauType) {
  // Phan tich do dai cac chu ky truoc
  // Muc tieu: khi cau A gay, cau B tiep theo thuong la gi?

  if (blocks.length < 4) return { nextType:"khong ro", confidence:50 };

  const lens = blocks.slice(-8).map(b => b.len);

  // Tinh tan suat xuat hien do dai block
  const freq = {};
  lens.forEach(l => { freq[l] = (freq[l]||0)+1; });
  const sortedLens = Object.entries(freq).sort((a,b)=>b[1]-a[1]);
  const mostCommon = Number(sortedLens[0][0]);

  // Neu cau hien tai la bet dai => sau khi gay thuong ra 1-1
  if (cauType && cauType.startsWith("bet") || blocks[blocks.length-1].len >= 4) {
    return { nextType:"1-1 hoac 2-2", confidence:65 };
  }

  // Neu cau 1-1 => thuong chuyen sang 2-2 hoac bet ngan
  if (cauType === "1-1") return { nextType:"2-2 hoac bet", confidence:60 };

  // Neu cau 2-2 => thuong chuyen sang 1-1 hoac 3-3
  if (cauType === "2-2") return { nextType:"1-1 hoac 3-3", confidence:62 };

  // Neu cau 3-3 => thuong chuyen sang 2-2 hoac 1-1
  if (cauType === "3-3") return { nextType:"1-1 hoac 2-2", confidence:60 };

  return { nextType:"khong ro", confidence:50 };
}

/* ---------- Ham tong hop phan tich cau ---------- */
function analyzePattern(history) {
  if (history.length < 6)
    return { cauHienTai:"chua du lieu", trangThai:"can them phien", xacNhan:false,
             breakProb:0, duDoanCau:"?", nextPatternInfo:"?", nextPrediction:null, confidence:50, reason:"" };

  const syms      = toSymbols(history);
  const blocks    = toBlocks(syms);
  const curBlock  = blocks[blocks.length - 1];
  const curStreak = getCurrentStreak(syms);

  const cauInfo   = classifyBlocks(blocks);
  const cauType   = cauInfo ? cauInfo.type : "random";
  const confirmed = cauInfo ? cauInfo.confirmed : false;

  const breakProb      = calcBreakProb(blocks, cauType);
  const nextPatternInfo= predictNextPattern(blocks, cauType);

  // --- Quyet dinh du doan phien toi ---
  let nextPrediction, reason, confidence;

  // TRUONG HOP 1: Cau xac nhan ro rang, xac suat gay thap => di tiep theo cau
  if (confirmed && breakProb < 0.45) {
    // Tinh phien hien tai trong chu ky la bao nhieu
    const cyclePos = cauInfo.cycleLen > 0 ? (curBlock.len % cauInfo.cycleLen) : curBlock.len;

    if (cauType === "1-1") {
      nextPrediction = flip(curBlock.val);
      reason = `Cau 1-1 xac nhan (${blocks.length} chu ky) => doi sang ${nextPrediction}`;
      confidence = confirmed ? 82 : 68;
    } else if (cauType === "2-2") {
      nextPrediction = curBlock.len >= 2 ? flip(curBlock.val) : cont(curBlock.val);
      reason = curBlock.len >= 2
        ? `Cau 2-2 xac nhan, block hien tai du 2 => doi sang ${nextPrediction}`
        : `Cau 2-2 xac nhan, block hien tai moi 1 => tiep ${nextPrediction}`;
      confidence = confirmed ? 80 : 66;
    } else if (cauType === "3-3") {
      nextPrediction = curBlock.len >= 3 ? flip(curBlock.val) : cont(curBlock.val);
      reason = curBlock.len >= 3
        ? `Cau 3-3 xac nhan, block hien tai du 3 => doi sang ${nextPrediction}`
        : `Cau 3-3 xac nhan, con ${3-curBlock.len} phien nua moi doi`;
      confidence = confirmed ? 78 : 64;
    } else if (cauType === "4-4") {
      nextPrediction = curBlock.len >= 4 ? flip(curBlock.val) : cont(curBlock.val);
      reason = curBlock.len >= 4
        ? `Cau 4-4 xac nhan, block hien tai du 4 => doi sang ${nextPrediction}`
        : `Cau 4-4 xac nhan, con ${4-curBlock.len} phien nua moi doi`;
      confidence = 76;
    } else if (cauType === "2-1" || cauType === "3-1" || cauType === "3-2") {
      // Lay lens 2 block cuoi de biet vi tri trong chu ky
      const prevBlock = blocks[blocks.length - 2];
      if (cauType === "2-1") {
        if (prevBlock.len === 2 && curBlock.len >= 1) {
          nextPrediction = cont(curBlock.val); // block ngan 1 van tiep
          reason = `Cau 2-1: block truoc dai 2, block nay moi ${curBlock.len} => tiep ${nextPrediction}`;
          if (curBlock.len >= 1 && prevBlock.len === 1) { nextPrediction = flip(curBlock.val); reason = `Cau 2-1: block don xong => doi sang ${nextPrediction}`; }
        } else {
          nextPrediction = curBlock.len >= 2 ? flip(curBlock.val) : cont(curBlock.val);
          reason = `Cau 2-1 => ${nextPrediction}`;
        }
      } else {
        nextPrediction = curBlock.len >= cauInfo.cycleLen ? flip(curBlock.val) : cont(curBlock.val);
        reason = `Cau ${cauType} => ${nextPrediction}`;
      }
      confidence = confirmed ? 74 : 62;
    } else if (cauType.startsWith("bet")) {
      // Bet on dinh => di tiep, nhung theo doi nguy co gay
      nextPrediction = cont(curBlock.val);
      reason = `Cau bet on dinh (trung binh ${cauInfo.cycleLen} phien/block) => tiep ${nextPrediction}`;
      confidence = 65;
    } else {
      nextPrediction = cont(curBlock.val);
      reason = `Cau chua ro, theo streak hien tai`;
      confidence = 55;
    }
  }

  // TRUONG HOP 2: Xac suat gay cao => du doan gay (doi chieu)
  else if (breakProb >= 0.65) {
    nextPrediction = flip(curBlock.val);
    reason = `CAY GAY: block hien tai ${curBlock.len} phien (qua dai so voi lich su) => du doan doi sang ${nextPrediction}`;
    confidence = Math.floor(55 + breakProb * 25);
  }

  // TRUONG HOP 3: Vung xam - chua chac chan
  else {
    // Dung Markov de quyet dinh
    const lastResult = history[history.length-1].result;
    let same=0, chg=0;
    const allSyms = syms;
    for (let i=1; i<allSyms.length; i++) {
      if (allSyms[i-1] === allSyms[allSyms.length-1]) {
        if (allSyms[i] === allSyms[allSyms.length-1]) same++; else chg++;
      }
    }
    nextPrediction = chg > same ? flip(curBlock.val) : cont(curBlock.val);
    reason = `Vung xam (xac suat gay ${Math.floor(breakProb*100)}%) => Markov cho ${nextPrediction}`;
    confidence = 58;
  }

  // Tang confidence khi nhieu thuat toan dong thuan
  const cauStr = cauInfo
    ? `${cauInfo.type}${confirmed ? " (XAC NHAN)" : " (THEO DOI)"}`
    : "random";

  return {
    cauHienTai:    cauStr,
    trangThai:     confirmed ? "xac nhan" : "chua xac nhan",
    xacNhan:       confirmed,
    cauLen:        curBlock.len,
    breakProb:     Math.floor(breakProb * 100),
    duDoanCauTiepTheo: nextPatternInfo.nextType,
    nextPrediction,
    confidence,
    reason,
  };
}

/* =========================
   PHAN TICH XUC XAC
========================= */

function diceAnalysis(history) {
  const valid    = history.filter((h) => h.hasRealDice);
  const src      = valid.length >= 3 ? valid : history;
  if (src.length < 3) return { prediction:null, confidence:50, note:"Chua du lieu", avgTotal:"?" };

  const recent   = src.slice(-5);
  const avgTotal = recent.reduce((s,h) => s+h.total, 0) / recent.length;
  const last     = src[src.length - 1];

  const isTriplet   = last.hasRealDice && last.dices[0]===last.dices[1] && last.dices[1]===last.dices[2];
  const isEvenTotal = last.total % 2 === 0;
  const isHighDice  = last.hasRealDice && last.dices.every((d) => d >= 4);
  const isLowDice   = last.hasRealDice && last.dices.every((d) => d <= 3);

  // Xu huong tong 3 phien lien tiep
  const last3      = src.slice(-3);
  const trendUp    = last3.length===3 && last3[2].total > last3[1].total && last3[1].total > last3[0].total;
  const trendDown  = last3.length===3 && last3[2].total < last3[1].total && last3[1].total < last3[0].total;

  let note=[], score=0;

  if (isTriplet) {
    note.push(`Bo ba ${last.dices[0]}-${last.dices[0]}-${last.dices[0]} => thuong dao chieu`);
    score += last.result==="tài" ? -35 : 35;
  }
  if (avgTotal > 10.5) { note.push(`TB5 ${avgTotal.toFixed(1)} cao => nghieng tai`);  score+=15; }
  else                 { note.push(`TB5 ${avgTotal.toFixed(1)} thap => nghieng xiu`); score-=15; }
  if (isHighDice)      { note.push("Ca3 xuc xac cao(>=4) => tai");  score+=20; }
  if (isLowDice)       { note.push("Ca3 xuc xac thap(<=3) => xiu"); score-=20; }
  if (trendUp)         { note.push("Tong tang lien tiep 3 phien => nghieng tai"); score+=12; }
  if (trendDown)       { note.push("Tong giam lien tiep 3 phien => nghieng xiu"); score-=12; }
  if (isEvenTotal)     { note.push("Tong chan => nhe nghieng le tiep");  score-=5; }
  else                 { note.push("Tong le => nhe nghieng chan tiep"); score+=5; }

  return {
    prediction: score>=0 ? "tài" : "xỉu",
    confidence: Math.floor(Math.min(85, 50+Math.abs(score)/2)),
    note:       note.join(" | "),
    avgTotal:   avgTotal.toFixed(1),
    isTriplet,
  };
}

/* =========================
   TONG HOP DU DOAN CUOI
========================= */

function superPredict(history) {
  const pa = analyzePattern(history);
  const di = diceAnalysis(history);

  // Bo phieu co trong so:
  // - Cau xac nhan: trong so cao nhat (x3)
  // - Cau chua xac nhan: trong so binh thuong (x1.5)
  // - Xuc xac: trong so trung binh (x1.5)
  // - Markov nhanh: trong so thap (x1)

  const votes = [];

  // Phieu tu phan tich cau (trong so cao nhat)
  if (pa.nextPrediction) {
    const w = pa.xacNhan ? 3.0 : 1.5;
    votes.push({ prediction: pa.nextPrediction, confidence: pa.confidence, weight: w, src: "cau" });
  }

  // Phieu tu xuc xac
  if (di.prediction) {
    votes.push({ prediction: di.prediction, confidence: di.confidence, weight: 1.5, src: "xuc_xac" });
  }

  // Markov tren 20 phien gan nhat
  const syms = toSymbols(history);
  const last20 = syms.slice(-20);
  const lastSym = last20[last20.length-1];
  let mSame=0, mChg=0;
  for (let i=1; i<last20.length; i++) {
    if (last20[i-1]===lastSym) { if(last20[i]===lastSym) mSame++; else mChg++; }
  }
  const mPred = mChg>mSame ? flip(lastSym) : cont(lastSym);
  const mConf = 50 + Math.abs(mChg-mSame) * 3;
  votes.push({ prediction: mPred, confidence: Math.min(mConf,75), weight: 1.0, src: "markov" });

  // Xu huong 10 phien
  const last10 = history.slice(-10);
  const taiCount = last10.filter(h=>h.result==="tài").length;
  const xiuCount = 10 - taiCount;
  // Nguoc lai xu huong (mean reversion)
  const trendPred = taiCount > xiuCount ? "xỉu" : "tài";
  votes.push({ prediction: trendPred, confidence: 55+Math.abs(taiCount-xiuCount)*2, weight: 0.8, src: "trend" });

  // Tinh tong diem co trong so
  let scoreTai=0, scoreXiu=0;
  votes.forEach(v => {
    const w = v.weight * v.confidence;
    if (v.prediction==="tài") scoreTai+=w; else scoreXiu+=w;
  });

  const total     = scoreTai + scoreXiu;
  const winner    = scoreTai > scoreXiu ? "tài" : "xỉu";
  const rawConf   = Math.floor((Math.max(scoreTai,scoreXiu)/total)*100);
  const finalConf = Math.min(rawConf, 93);

  // Kiem tra dong thuan: neu cau va xuc xac cung chieu => tang confidence
  const cauVote  = votes.find(v=>v.src==="cau");
  const diceVote = votes.find(v=>v.src==="xuc_xac");
  const bonus    = (cauVote && diceVote && cauVote.prediction===diceVote.prediction && pa.xacNhan) ? 3 : 0;

  return {
    prediction: winner,
    confidence: Math.min(finalConf + bonus, 93),
    patternAnalysis: pa,
    diceInfo: di,
    votes,
  };
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
    ? "\n[!] API khong tra ve xuc xac — chi du doan tu ket qua tai/xiu. Xem /debug\n"
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