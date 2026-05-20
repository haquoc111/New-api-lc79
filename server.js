const express = require("express");
const axios = require("axios");

const app = express();

const PORT = process.env.PORT || 3000;

const API =
  "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=2cff2322cadccdcb7afd52aa2f828f83";

/* =========================
   TÀI/XỈU
========================= */

function getResult(total) {
  return total >= 11 ? "tài" : "xỉu";
}

/* =========================
   THUẬT TOÁN
========================= */

function trendPredict(history) {
  let tai = 0;
  let xiu = 0;

  history.slice(-10).forEach((i) => {
    if (i.result === "tài") tai++;
    else xiu++;
  });

  if (tai > xiu) {
    return {
      prediction: "xỉu",
      confidence: 70,
    };
  }

  return {
    prediction: "tài",
    confidence: 70,
  };
}

function streakPredict(history) {
  const last = history[history.length - 1];

  let streak = 1;

  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].result === last.result) {
      streak++;
    } else {
      break;
    }
  }

  if (streak >= 3) {
    return {
      prediction:
        last.result === "tài"
          ? "xỉu"
          : "tài",
      confidence: 85,
    };
  }

  return {
    prediction: last.result,
    confidence: 60,
  };
}

function markovPredict(history) {
  if (history.length < 5) {
    return {
      prediction: "tài",
      confidence: 50,
    };
  }

  const last =
    history[history.length - 1].result;

  let same = 0;
  let change = 0;

  for (let i = 1; i < history.length; i++) {
    if (history[i - 1].result === last) {
      if (history[i].result === last)
        same++;
      else change++;
    }
  }

  if (change > same) {
    return {
      prediction:
        last === "tài" ? "xỉu" : "tài",
      confidence: 75,
    };
  }

  return {
    prediction: last,
    confidence: 75,
  };
}

function superPredict(history) {
  const algos = [
    trendPredict(history),
    streakPredict(history),
    markovPredict(history),
  ];

  let tai = 0;
  let xiu = 0;

  algos.forEach((a) => {
    if (a.prediction === "tài") {
      tai += a.confidence;
    } else {
      xiu += a.confidence;
    }
  });

  return {
    prediction: tai > xiu ? "tài" : "xỉu",
    confidence: Math.floor(
      Math.max(tai, xiu) / algos.length
    ),
  };
}

/* =========================
   LOAD DATA
========================= */

async function getData() {
  try {
    const res = await axios.get(API, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });

    console.log(
      "API RESPONSE:",
      JSON.stringify(res.data).slice(0, 500)
    );

    let raw = [];

    if (Array.isArray(res.data)) {
      raw = res.data;
    } else if (Array.isArray(res.data.data)) {
      raw = res.data.data;
    } else if (
      Array.isArray(res.data.sessions)
    ) {
      raw = res.data.sessions;
    } else if (
      Array.isArray(res.data.result)
    ) {
      raw = res.data.result;
    }

    if (!raw.length) {
      return [];
    }

    return raw.map((item) => {
      const d1 = Number(
        item.d1 ||
          item.dice1 ||
          item.x1 ||
          1
      );

      const d2 = Number(
        item.d2 ||
          item.dice2 ||
          item.x2 ||
          1
      );

      const d3 = Number(
        item.d3 ||
          item.dice3 ||
          item.x3 ||
          1
      );

      const total = d1 + d2 + d3;

      return {
        id: item.id || "s2king",
        session:
          item.session ||
          item.issue ||
          item.sid ||
          0,
        dices: [d1, d2, d3],
        total,
        result: getResult(total),
      };
    });
  } catch (e) {
    console.log("ERROR:", e.message);
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

  const last =
    history[history.length - 1];

  const predict = superPredict(history);

  res.send(`
Id: s2king
Phien:${last.session}
Ket_qua:${last.result}
Xuc_xac:${last.dices.join("-")}
Phien_hien_tai:${Number(last.session) + 1}
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