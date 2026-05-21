const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const API =
  "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=2cff2322cadccdcb7afd52aa2f828f83";

/* =========================
   TÀI / XỈU
========================= */

function getResult(total) {
  return total >= 11 ? "tài" : "xỉu";
}

/* =========================
   NHẬN DIỆN CẦU (PATTERN)
========================= */

/**
 * Chuyển mảng kết quả thành chuỗi ký tự để dễ so pattern
 * "tài" => "T", "xỉu" => "X"
 */
function toSymbols(history) {
  return history.map((h) => (h.result === "tài" ? "T" : "X"));
}

/**
 * Đếm chuỗi bệt hiện tại (cùng kết quả liên tiếp ở cuối)
 */
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

/**
 * Nhận diện loại cầu từ lịch sử gần nhất
 * Trả về: { pattern, description, nextPrediction }
 *
 * Các cầu được nhận diện:
 *  - Bệt (tất cả giống nhau: T T T T / X X X X)
 *  - 1-1 (xen kẽ: T X T X / X T X T)
 *  - 2-2 (cặp đôi: TT XX TT XX)
 *  - 3-3 (bộ ba: TTT XXX TTT)
 *  - 3-4, 4-3 (bộ không đều)
 *  - 2-1, 1-2 (lẻ)
 *  - Ngẫu nhiên
 */
function detectPattern(history) {
  const n = history.length;
  if (n < 4) {
    return {
      pattern: "chưa đủ dữ liệu",
      description: "Cần thêm phiên",
      confidence: 50,
      nextPrediction: null,
    };
  }

  const syms = toSymbols(history);
  const recent = syms.slice(-12); // lấy 12 phiên gần nhất

  // --- Cầu bệt ---
  // Toàn bộ recent giống nhau
  if (recent.every((s) => s === recent[0])) {
    const streak = getCurrentStreak(syms);
    return {
      pattern: `cầu bệt ${streak.type} (${streak.count} phiên)`,
      description: `Đang bệt ${streak.type} liên tiếp ${streak.count} phiên`,
      confidence: streak.count >= 5 ? 60 : 75,
      // Khi bệt dài (>=5) thì có thể gãy, ngắn thì đi tiếp
      nextPrediction: streak.count >= 5 ? (streak.type === "tài" ? "xỉu" : "tài") : streak.type,
    };
  }

  // --- Cầu 1-1 (xen kẽ) ---
  // Kiểm tra 8 phiên cuối xem có xen kẽ không
  const last8 = recent.slice(-8);
  let isAlt = true;
  for (let i = 1; i < last8.length; i++) {
    if (last8[i] === last8[i - 1]) { isAlt = false; break; }
  }
  if (isAlt && last8.length >= 6) {
    const next = last8[last8.length - 1] === "T" ? "xỉu" : "tài";
    return {
      pattern: "cầu 1-1 (xen kẽ)",
      description: "Tài Xỉu đan xen đều đặn",
      confidence: 82,
      nextPrediction: next,
    };
  }

  // --- Helper: tách chuỗi thành các block liên tiếp ---
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

  const blocks = toBlocks(recent);

  // --- Cầu 2-2 ---
  if (blocks.length >= 4) {
    const lens = blocks.slice(-4).map((b) => b.len);
    if (lens.every((l) => l === 2)) {
      const lastBlock = blocks[blocks.length - 1];
      const next = lastBlock.val === "T" ? "xỉu" : "tài";
      return {
        pattern: "cầu 2-2",
        description: "Mỗi cặp 2 Tài rồi 2 Xỉu xen kẽ",
        confidence: 80,
        nextPrediction: next,
      };
    }
  }

  // --- Cầu 3-3 ---
  if (blocks.length >= 4) {
    const lens = blocks.slice(-4).map((b) => b.len);
    if (lens.every((l) => l === 3)) {
      const lastBlock = blocks[blocks.length - 1];
      const next = lastBlock.val === "T" ? "xỉu" : "tài";
      return {
        pattern: "cầu 3-3",
        description: "Mỗi nhóm 3 Tài rồi 3 Xỉu",
        confidence: 78,
        nextPrediction: next,
      };
    }
  }

  // --- Cầu 3-4 hoặc 4-3 ---
  if (blocks.length >= 4) {
    const lens = blocks.slice(-4).map((b) => b.len);
    const isThreeFour = lens.every((l) => l === 3 || l === 4);
    if (isThreeFour) {
      const lastBlock = blocks[blocks.length - 1];
      // Nếu block cuối đã đủ 3 thì dự đoán đổi
      const next = lastBlock.len >= 3
        ? (lastBlock.val === "T" ? "xỉu" : "tài")
        : lastBlock.val === "T" ? "tài" : "xỉu";
      return {
        pattern: "cầu 3-4",
        description: "Nhóm 3-4 xen kẽ",
        confidence: 72,
        nextPrediction: next,
      };
    }
  }

  // --- Cầu 2-1 ---
  if (blocks.length >= 4) {
    const lens = blocks.slice(-4).map((b) => b.len);
    const isTwoOne = lens.every((l) => l === 1 || l === 2);
    if (isTwoOne) {
      const lastBlock = blocks[blocks.length - 1];
      const streak2 = getCurrentStreak(syms);
      // Nếu block cuối là 2 thì đổi, nếu là 1 thì có thể tiếp hoặc đổi
      const next = lastBlock.len >= 2
        ? (lastBlock.val === "T" ? "xỉu" : "tài")
        : lastBlock.val === "T" ? "tài" : "xỉu";
      return {
        pattern: "cầu 2-1",
        description: "Xen kẽ cặp 2 và đơn 1",
        confidence: 68,
        nextPrediction: next,
      };
    }
  }

  // --- Cầu 1-2 ---
  if (blocks.length >= 4) {
    const lens = blocks.slice(-4).map((b) => b.len);
    // 1-2-1-2
    if (lens[0] === 1 && lens[1] === 2 && lens[2] === 1 && lens[3] === 2) {
      const lastBlock = blocks[blocks.length - 1];
      const next = lastBlock.val === "T" ? "xỉu" : "tài";
      return {
        pattern: "cầu 1-2",
        description: "Đơn rồi cặp đôi xen kẽ",
        confidence: 72,
        nextPrediction: next,
      };
    }
    if (lens[0] === 2 && lens[1] === 1 && lens[2] === 2 && lens[3] === 1) {
      const lastBlock = blocks[blocks.length - 1];
      const next = lastBlock.val === "T" ? "tài" : "xỉu";
      return {
        pattern: "cầu 2-1",
        description: "Cặp đôi rồi đơn xen kẽ",
        confidence: 72,
        nextPrediction: next,
      };
    }
  }

  // --- Cầu bệt hiện tại (streak ngắn) ---
  const streak = getCurrentStreak(syms);
  if (streak.count >= 2) {
    return {
      pattern: `cầu bệt nhẹ (${streak.count} phiên)`,
      description: `${streak.type} đang chạy ${streak.count} phiên`,
      confidence: 62,
      nextPrediction: streak.type, // đi tiếp theo streak
    };
  }

  // --- Không nhận diện được rõ ---
  return {
    pattern: "cầu ngẫu nhiên",
    description: "Không có pattern rõ ràng",
    confidence: 52,
    nextPrediction: null,
  };
}

/* =========================
   PHÂN TÍCH XÚC XẮC CHI TIẾT
========================= */

/**
 * Phân tích chi tiết từ xúc xắc:
 * - Tổng điểm xu hướng
 * - Bộ ba (ba xúc xắc giống nhau) => hiếm, dự đoán đổi
 * - Tổng chẵn/lẻ
 * - Xúc xắc cao/thấp
 */
function diceAnalysis(history) {
  if (history.length < 3) return { prediction: null, confidence: 50, note: "Chưa đủ dữ liệu" };

  const recent = history.slice(-5);

  // Tổng trung bình 5 phiên gần nhất
  const avgTotal = recent.reduce((s, h) => s + h.total, 0) / recent.length;

  // Đếm bộ ba (triplet) trong 5 phiên
  let tripletCount = 0;
  recent.forEach((h) => {
    if (h.dices[0] === h.dices[1] && h.dices[1] === h.dices[2]) tripletCount++;
  });

  // Phiên hiện tại
  const last = history[history.length - 1];
  const isTriplet = last.dices[0] === last.dices[1] && last.dices[1] === last.dices[2];
  const isEvenTotal = last.total % 2 === 0;
  const isHighDice = last.dices.every((d) => d >= 4); // cả 3 xúc xắc cao
  const isLowDice  = last.dices.every((d) => d <= 3); // cả 3 xúc xắc thấp

  let note = [];
  let score = 0; // dương => tài, âm => xỉu

  // Bộ ba => thường đổi ngay
  if (isTriplet) {
    note.push(`Bộ ba ${last.dices[0]}-${last.dices[0]}-${last.dices[0]} => thường đảo chiều`);
    score += last.result === "tài" ? -30 : 30;
  }

  // Tổng trung bình cao => xu hướng tài
  if (avgTotal > 10.5) {
    note.push(`Tổng TB 5 phiên ${avgTotal.toFixed(1)} > 10.5 => nghiêng tài`);
    score += 15;
  } else {
    note.push(`Tổng TB 5 phiên ${avgTotal.toFixed(1)} ≤ 10.5 => nghiêng xỉu`);
    score -= 15;
  }

  // Cả 3 xúc xắc cao => nghiêng tài
  if (isHighDice) {
    note.push("Cả 3 xúc xắc cao (≥4) => nghiêng tài");
    score += 20;
  }
  // Cả 3 xúc xắc thấp => nghiêng xỉu
  if (isLowDice) {
    note.push("Cả 3 xúc xắc thấp (≤3) => nghiêng xỉu");
    score -= 20;
  }

  // Tổng chẵn/lẻ nhỏ ảnh hưởng
  if (isEvenTotal) {
    note.push("Tổng chẵn => nhẹ nghiêng tiếp theo lẻ");
    score -= 5;
  } else {
    note.push("Tổng lẻ => nhẹ nghiêng tiếp theo chẵn");
    score += 5;
  }

  const prediction = score >= 0 ? "tài" : "xỉu";
  const confidence = Math.min(85, 50 + Math.abs(score) / 2);

  return {
    prediction,
    confidence: Math.floor(confidence),
    note: note.join(" | "),
    avgTotal: avgTotal.toFixed(1),
    isTriplet,
  };
}

/* =========================
   THUẬT TOÁN GỐC
========================= */

function trendPredict(history) {
  let tai = 0, xiu = 0;
  history.slice(-10).forEach((i) => {
    if (i.result === "tài") tai++;
    else xiu++;
  });
  return tai > xiu
    ? { prediction: "xỉu", confidence: 70 }
    : { prediction: "tài", confidence: 70 };
}

function streakPredict(history) {
  const last = history[history.length - 1];
  let streak = 1;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].result === last.result) streak++;
    else break;
  }
  if (streak >= 3) {
    return {
      prediction: last.result === "tài" ? "xỉu" : "tài",
      confidence: 85,
    };
  }
  return { prediction: last.result, confidence: 60 };
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
  if (change > same) {
    return { prediction: last === "tài" ? "xỉu" : "tài", confidence: 75 };
  }
  return { prediction: last, confidence: 75 };
}

/* =========================
   TỔNG HỢP DỰ ĐOÁN (SUPER)
========================= */

function superPredict(history) {
  // Thuật toán gốc
  const algos = [
    trendPredict(history),
    streakPredict(history),
    markovPredict(history),
  ];

  // Thuật toán cầu
  const patternInfo = detectPattern(history);
  if (patternInfo.nextPrediction) {
    algos.push({
      prediction: patternInfo.nextPrediction,
      confidence: patternInfo.confidence,
    });
  }

  // Thuật toán xúc xắc
  const diceInfo = diceAnalysis(history);
  if (diceInfo.prediction) {
    algos.push({
      prediction: diceInfo.prediction,
      confidence: diceInfo.confidence,
    });
  }

  let tai = 0, xiu = 0;
  algos.forEach((a) => {
    if (a.prediction === "tài") tai += a.confidence;
    else xiu += a.confidence;
  });

  const totalScore = tai + xiu;
  const winnerScore = Math.max(tai, xiu);
  const overallConfidence = Math.floor((winnerScore / totalScore) * 100);

  return {
    prediction: tai > xiu ? "tài" : "xỉu",
    confidence: Math.min(overallConfidence, 95),
    patternInfo,
    diceInfo,
  };
}

/* =========================
   LOAD DATA
========================= */

async function getData() {
  try {
    const res = await axios({
      method: "GET",
      url: API,
      timeout: 10000,
      headers: {
        "accept": "*/*",
        "accept-language": "vi-VN,vi;q=0.9",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "referer": "https://tele68.com/",
        "origin": "https://tele68.com",
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile Safari/604.1",
      },
    });

    console.log("STATUS:", res.status);
    let raw = res.data;
    console.log("RAW:", JSON.stringify(raw).slice(0, 1000));

    let arr = [];
    if (Array.isArray(raw)) {
      arr = raw;
    } else {
      for (const key in raw) {
        if (Array.isArray(raw[key])) { arr = raw[key]; break; }
      }
    }

    if (!arr.length) {
      console.log("Không tìm thấy mảng data");
      return [];
    }

    const history = arr.map((item) => {
      const d1 = Number(item.d1 || item.dice1 || item.x1 || item.red1 || 1);
      const d2 = Number(item.d2 || item.dice2 || item.x2 || item.red2 || 1);
      const d3 = Number(item.d3 || item.dice3 || item.x3 || item.red3 || 1);
      const total = d1 + d2 + d3;

      return {
        id: item.id || "s2king",
        session:
          item.session || item.issue || item.sid || item.expect || item.round || 0,
        dices: [d1, d2, d3],
        total,
        result: total >= 11 ? "tài" : "xỉu",
      };
    });

    return history;
  } catch (err) {
    console.log("FULL ERROR:", err.response?.data || err.message);
    return [];
  }
}

/* =========================
   API
========================= */

app.get("/", async (req, res) => {
  const history = await getData();

  if (!history.length) {
    return res.send(`
Không lấy được dữ liệu

Kiểm tra:
- API còn sống không
- Bị chặn cloudflare không
- API đổi cấu trúc chưa
`);
  }

  const last    = history[history.length - 1];
  const predict = superPredict(history);
  const streak  = getCurrentStreak(toSymbols(history));

  res.send(`
Id: s2king
Phien:${last.session}
Ket_qua:${last.result}
Xuc_xac:${last.dices.join("-")}
Tong:${last.total}
Phien_hien_tai:${Number(last.session) + 1}

--- CAU DANG CHAY ---
Loai_cau:${predict.patternInfo.pattern}
Mo_ta:${predict.patternInfo.description}
Bet_hien_tai:${streak.type} x${streak.count} phien

--- PHAN_TICH_XUC_XAC ---
Tong_TB_5_phien:${predict.diceInfo.avgTotal}
Chi_tiet:${predict.diceInfo.note}

--- DU DOAN ---
Du_doan:${predict.prediction}
Do_tin_cay:${predict.confidence}%
`);
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log("Server chạy cổng", PORT);
});
