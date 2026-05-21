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
   PARSE XÚC XẮC TỪ ITEM
   Thử toàn bộ tên field phổ biến,
   kể cả trường hợp API gộp trong 1 string
========================= */

function parseDices(item) {
  // --- 3 field riêng lẻ ---
  const KEYS_D1 = ["d1","dice1","x1","red1","v1","num1","n1","open1","openNum1","s1","p1","point1"];
  const KEYS_D2 = ["d2","dice2","x2","red2","v2","num2","n2","open2","openNum2","s2","p2","point2"];
  const KEYS_D3 = ["d3","dice3","x3","red3","v3","num3","n3","open3","openNum3","s3","p3","point3"];

  let d1 = null, d2 = null, d3 = null;

  for (const k of KEYS_D1) if (item[k] != null && Number(item[k]) > 0) { d1 = Number(item[k]); break; }
  for (const k of KEYS_D2) if (item[k] != null && Number(item[k]) > 0) { d2 = Number(item[k]); break; }
  for (const k of KEYS_D3) if (item[k] != null && Number(item[k]) > 0) { d3 = Number(item[k]); break; }

  if (d1 && d2 && d3) return [d1, d2, d3];

  // --- Field gộp dạng "1,2,3" hoặc "1-2-3" hoặc "123" ---
  const KEYS_COMBO = [
    "openCode","open_code","openNum","open_num","dices","dice","nums","num",
    "number","numbers","result_num","resultNum","point","points","values",
    "balls","ball","xucxac","xuc_xac","code","resultCode","result_code",
  ];

  for (const k of KEYS_COMBO) {
    const val = item[k];
    if (!val) continue;
    const str = String(val);

    // "1,2,3" hoặc "1-2-3" hoặc "1 2 3"
    const parts = str.split(/[,\-\s]+/).map(Number).filter((n) => n >= 1 && n <= 6);
    if (parts.length === 3) return parts;

    // "123" => [1,2,3]
    if (/^\d{3}$/.test(str.trim())) {
      const p = str.trim().split("").map(Number);
      if (p.every((n) => n >= 1 && n <= 6)) return p;
    }
  }

  // --- Kiểm tra nested object ---
  for (const key in item) {
    const val = item[key];
    if (Array.isArray(val) && val.length === 3) {
      const p = val.map(Number);
      if (p.every((n) => n >= 1 && n <= 6)) return p;
    }
  }

  // --- Không tìm được => trả null để cảnh báo ---
  return null;
}

function parseSession(item) {
  const KEYS = [
    "session","issue","sid","expect","round","期号","no","id",
    "phien","period","periodId","period_id","roundId","round_id",
    "issue_no","issueNo","drawNo","draw_no","number",
  ];
  for (const k of KEYS) {
    if (item[k] != null && item[k] !== "" && item[k] !== 0) return item[k];
  }
  return "?";
}

/* =========================
   TÀI / XỈU
========================= */

function getResult(total) {
  return total >= 11 ? "tài" : "xỉu";
}

/* =========================
   NHẬN DIỆN CẦU (PATTERN)
========================= */

function toSymbols(history) {
  return history.map((h) => (h.result === "tài" ? "T" : "X"));
}

function getCurrentStreak(symbols) {
  if (!symbols.length) return { type: null, count: 0 };
  const last = symbols[symbols.length - 1];
  let count = 0;
  for (let i = symbols.length - 1; i >= 0; i--) {
    if (symbols[i] === last) count++;
    else break;
  }
  return { type: last === "T" ? "tài" : "xỉu", count };
}

function toBlocks(arr) {
  if (!arr.length) return [];
  const blocks = [];
  let cur = { val: arr[0], len: 1 };
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === cur.val) cur.len++;
    else { blocks.push(cur); cur = { val: arr[i], len: 1 }; }
  }
  blocks.push(cur);
  return blocks;
}

function detectPattern(history) {
  if (history.length < 4) {
    return { pattern: "chưa đủ dữ liệu", description: "Cần thêm phiên", confidence: 50, nextPrediction: null };
  }

  const syms   = toSymbols(history);
  const recent = syms.slice(-12);

  // Cầu bệt toàn bộ
  if (recent.every((s) => s === recent[0])) {
    const streak = getCurrentStreak(syms);
    return {
      pattern:        `cầu bệt ${streak.type} (${streak.count} phiên)`,
      description:    `Đang bệt ${streak.type} liên tiếp ${streak.count} phiên`,
      confidence:     streak.count >= 5 ? 60 : 75,
      nextPrediction: streak.count >= 5 ? (streak.type === "tài" ? "xỉu" : "tài") : streak.type,
    };
  }

  // Cầu 1-1
  const last8 = recent.slice(-8);
  let isAlt = last8.length >= 6;
  for (let i = 1; i < last8.length; i++) {
    if (last8[i] === last8[i - 1]) { isAlt = false; break; }
  }
  if (isAlt) {
    return {
      pattern:        "cầu 1-1 (xen kẽ)",
      description:    "Tài Xỉu đan xen đều đặn",
      confidence:     82,
      nextPrediction: last8[last8.length - 1] === "T" ? "xỉu" : "tài",
    };
  }

  const blocks = toBlocks(recent);

  const checkBlocks = (lens, target) => lens.every((l) => l === target);
  const checkBlocksSet = (lens, set) => lens.every((l) => set.includes(l));

  if (blocks.length >= 4) {
    const lens = blocks.slice(-4).map((b) => b.len);
    const last = blocks[blocks.length - 1];

    if (checkBlocks(lens, 2))
      return { pattern: "cầu 2-2", description: "Cặp 2 Tài / 2 Xỉu xen kẽ", confidence: 80,
               nextPrediction: last.val === "T" ? "xỉu" : "tài" };

    if (checkBlocks(lens, 3))
      return { pattern: "cầu 3-3", description: "Nhóm 3 Tài / 3 Xỉu xen kẽ", confidence: 78,
               nextPrediction: last.val === "T" ? "xỉu" : "tài" };

    if (checkBlocksSet(lens, [3, 4]))
      return { pattern: "cầu 3-4", description: "Nhóm 3-4 xen kẽ", confidence: 72,
               nextPrediction: last.len >= 3 ? (last.val === "T" ? "xỉu" : "tài") : (last.val === "T" ? "tài" : "xỉu") };

    // 1-2-1-2
    if (lens[0]===1 && lens[1]===2 && lens[2]===1 && lens[3]===2)
      return { pattern: "cầu 1-2", description: "Đơn rồi cặp đôi xen kẽ", confidence: 72,
               nextPrediction: last.val === "T" ? "xỉu" : "tài" };

    // 2-1-2-1
    if (lens[0]===2 && lens[1]===1 && lens[2]===2 && lens[3]===1)
      return { pattern: "cầu 2-1", description: "Cặp đôi rồi đơn xen kẽ", confidence: 72,
               nextPrediction: last.len >= 2 ? (last.val === "T" ? "xỉu" : "tài") : (last.val === "T" ? "tài" : "xỉu") };

    if (checkBlocksSet(lens, [1, 2]))
      return { pattern: "cầu 2-1", description: "Xen kẽ cặp 2 và đơn 1", confidence: 68,
               nextPrediction: last.len >= 2 ? (last.val === "T" ? "xỉu" : "tài") : (last.val === "T" ? "tài" : "xỉu") };
  }

  const streak = getCurrentStreak(syms);
  if (streak.count >= 2)
    return { pattern: `cầu bệt nhẹ (${streak.count} phiên)`, description: `${streak.type} đang chạy ${streak.count} phiên`,
             confidence: 62, nextPrediction: streak.type };

  return { pattern: "cầu ngẫu nhiên", description: "Không có pattern rõ ràng", confidence: 52, nextPrediction: null };
}

/* =========================
   PHÂN TÍCH XÚC XẮC CHI TIẾT
========================= */

function diceAnalysis(history) {
  if (history.length < 3) return { prediction: null, confidence: 50, note: "Chưa đủ dữ liệu", avgTotal: "0" };

  const recent   = history.slice(-5);
  const avgTotal = recent.reduce((s, h) => s + h.total, 0) / recent.length;
  const last     = history[history.length - 1];

  const isTriplet  = last.dices[0] === last.dices[1] && last.dices[1] === last.dices[2];
  const isEvenTotal= last.total % 2 === 0;
  const isHighDice = last.dices.every((d) => d >= 4);
  const isLowDice  = last.dices.every((d) => d <= 3);

  let note  = [];
  let score = 0;

  if (isTriplet) {
    note.push(`Bộ ba ${last.dices[0]}-${last.dices[0]}-${last.dices[0]} => thường đảo chiều`);
    score += last.result === "tài" ? -30 : 30;
  }
  if (avgTotal > 10.5) { note.push(`TB 5 phiên ${avgTotal.toFixed(1)} > 10.5 => nghiêng tài`);  score += 15; }
  else                 { note.push(`TB 5 phiên ${avgTotal.toFixed(1)} ≤ 10.5 => nghiêng xỉu`); score -= 15; }
  if (isHighDice)      { note.push("Cả 3 xúc xắc cao (≥4) => nghiêng tài");  score += 20; }
  if (isLowDice)       { note.push("Cả 3 xúc xắc thấp (≤3) => nghiêng xỉu"); score -= 20; }
  if (isEvenTotal)     { note.push("Tổng chẵn => nhẹ nghiêng lẻ tiếp");  score -= 5; }
  else                 { note.push("Tổng lẻ => nhẹ nghiêng chẵn tiếp"); score += 5; }

  return {
    prediction: score >= 0 ? "tài" : "xỉu",
    confidence: Math.floor(Math.min(85, 50 + Math.abs(score) / 2)),
    note:       note.join(" | "),
    avgTotal:   avgTotal.toFixed(1),
    isTriplet,
  };
}

/* =========================
   THUẬT TOÁN GỐC
========================= */

function trendPredict(history) {
  let tai = 0, xiu = 0;
  history.slice(-10).forEach((i) => { if (i.result === "tài") tai++; else xiu++; });
  return tai > xiu ? { prediction: "xỉu", confidence: 70 } : { prediction: "tài", confidence: 70 };
}

function streakPredict(history) {
  const last = history[history.length - 1];
  let streak = 1;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].result === last.result) streak++;
    else break;
  }
  return streak >= 3
    ? { prediction: last.result === "tài" ? "xỉu" : "tài", confidence: 85 }
    : { prediction: last.result, confidence: 60 };
}

function markovPredict(history) {
  if (history.length < 5) return { prediction: "tài", confidence: 50 };
  const last = history[history.length - 1].result;
  let same = 0, change = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i - 1].result === last) {
      if (history[i].result === last) same++;
      else change++;
    }
  }
  return change > same
    ? { prediction: last === "tài" ? "xỉu" : "tài", confidence: 75 }
    : { prediction: last, confidence: 75 };
}

/* =========================
   TỔNG HỢP DỰ ĐOÁN
========================= */

function superPredict(history) {
  const algos = [trendPredict(history), streakPredict(history), markovPredict(history)];

  const patternInfo = detectPattern(history);
  if (patternInfo.nextPrediction) algos.push({ prediction: patternInfo.nextPrediction, confidence: patternInfo.confidence });

  const diceInfo = diceAnalysis(history);
  if (diceInfo.prediction) algos.push({ prediction: diceInfo.prediction, confidence: diceInfo.confidence });

  let tai = 0, xiu = 0;
  algos.forEach((a) => { if (a.prediction === "tài") tai += a.confidence; else xiu += a.confidence; });

  const total      = tai + xiu;
  const confidence = Math.min(Math.floor((Math.max(tai, xiu) / total) * 100), 95);

  return { prediction: tai > xiu ? "tài" : "xỉu", confidence, patternInfo, diceInfo };
}

/* =========================
   LOAD DATA
========================= */

async function getData() {
  try {
    const res = await axios({ method: "GET", url: API, timeout: 10000, headers: HEADERS });
    console.log("STATUS:", res.status);

    let raw = res.data;
    console.log("RAW SAMPLE:", JSON.stringify(raw).slice(0, 2000));

    // Tìm mảng trong response
    let arr = [];
    if (Array.isArray(raw)) {
      arr = raw;
    } else if (raw && typeof raw === "object") {
      // Thử các key phổ biến trước
      const priorityKeys = ["data","list","records","rows","items","result","results","history","sessions","issues","periods"];
      for (const k of priorityKeys) {
        if (Array.isArray(raw[k]) && raw[k].length > 0) { arr = raw[k]; break; }
      }
      // Nếu chưa tìm được, duyệt tất cả key
      if (!arr.length) {
        for (const key in raw) {
          if (Array.isArray(raw[key]) && raw[key].length > 0) { arr = raw[key]; break; }
        }
      }
      // Nested: raw.data.list chẳng hạn
      if (!arr.length && raw.data && typeof raw.data === "object") {
        for (const key in raw.data) {
          if (Array.isArray(raw.data[key]) && raw.data[key].length > 0) { arr = raw.data[key]; break; }
        }
      }
    }

    if (!arr.length) {
      console.log("Không tìm thấy mảng data. Keys có trong response:", Object.keys(raw || {}));
      return [];
    }

    console.log("Tìm thấy", arr.length, "phiên. Mẫu item[0]:", JSON.stringify(arr[0]).slice(0, 500));

    const history = arr.map((item) => {
      const dices   = parseDices(item);
      const session = parseSession(item);

      if (!dices) {
        // Không parse được xúc xắc => log item để debug
        console.log("WARN: không parse được xúc xắc từ item:", JSON.stringify(item).slice(0, 300));
      }

      const [d1, d2, d3] = dices || [1, 1, 1];
      const total        = d1 + d2 + d3;

      return {
        id:      "s2king",
        session,
        dices:   [d1, d2, d3],
        total,
        result:  total >= 11 ? "tài" : "xỉu",
        rawItem: dices ? null : item, // giữ raw nếu parse thất bại
      };
    });

    return history;
  } catch (err) {
    console.log("FULL ERROR:", err.response?.data || err.message);
    return [];
  }
}

/* =========================
   ROUTES
========================= */

// Route chính
app.get("/", async (req, res) => {
  const history = await getData();

  if (!history.length) {
    return res.send(`Không lấy được dữ liệu\nKiểm tra log server để xem lỗi chi tiết.`);
  }

  // Kiểm tra xem có phiên nào parse xúc xắc thất bại không
  const failCount = history.filter((h) => h.dices[0] === 1 && h.dices[1] === 1 && h.dices[2] === 1).length;
  const warnLine  = failCount > history.length * 0.5
    ? `\nCANH_BAO: ${failCount}/${history.length} phien khong parse duoc xuc xac - xem /debug\n`
    : "";

  const last    = history[history.length - 1];
  const predict = superPredict(history);
  const streak  = getCurrentStreak(toSymbols(history));

  res.send(`Id: s2king
Phien:${last.session}
Ket_qua:${last.result}
Xuc_xac:${last.dices.join("-")}
Tong:${last.total}
Phien_hien_tai:${Number(last.session) + 1}
${warnLine}
--- CAU DANG CHAY ---
Loai_cau:${predict.patternInfo.pattern}
Mo_ta:${predict.patternInfo.description}
Bet_hien_tai:${streak.type} x${streak.count} phien

--- PHAN_TICH_XUC_XAC ---
Tong_TB_5_phien:${predict.diceInfo.avgTotal}
Chi_tiet:${predict.diceInfo.note}

--- DU DOAN ---
Du_doan:${predict.prediction}
Do_tin_cay:${predict.confidence}%`);
});

// Route debug: in raw JSON để xem cấu trúc thực tế
app.get("/debug", async (req, res) => {
  try {
    const r = await axios({ method: "GET", url: API, timeout: 10000, headers: HEADERS });
    const raw = r.data;

    // Tìm mảng
    let arr = [];
    if (Array.isArray(raw)) arr = raw;
    else {
      const priorityKeys = ["data","list","records","rows","items","result","results","history","sessions","issues","periods"];
      for (const k of priorityKeys) { if (Array.isArray(raw[k]) && raw[k].length) { arr = raw[k]; break; } }
      if (!arr.length) for (const key in raw) { if (Array.isArray(raw[key]) && raw[key].length) { arr = raw[key]; break; } }
    }

    res.json({
      status:       r.status,
      topLevelKeys: Object.keys(raw || {}),
      arrayLength:  arr.length,
      // 3 item đầu để xem field name thực tế
      sample:       arr.slice(0, 3),
      fullRaw:      typeof raw === "object" ? raw : String(raw).slice(0, 3000),
    });
  } catch (err) {
    res.json({ error: err.message, detail: err.response?.data });
  }
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log("Server chạy cổng", PORT);
});
