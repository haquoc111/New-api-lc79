// server.js

const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL =
  "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=2cff2322cadccdcb7afd52aa2f828f83";

let history = [];

/* =========================
   HÀM PHÂN TÍCH TÀI/XỈU
========================= */

function getTaiXiu(total) {
  return total >= 11 ? "tài" : "xỉu";
}

function frequencyPredict(list) {
  let tai = 0;
  let xiu = 0;

  list.slice(-10).forEach((i) => {
    if (i.result === "tài") tai++;
    else xiu++;
  });

  if (tai > xiu) {
    return {
      prediction: "xỉu",
      confidence: 65,
    };
  }

  return {
    prediction: "tài",
    confidence: 65,
  };
}

function streakPredict(list) {
  if (list.length < 4) {
    return {
      prediction: "tài",
      confidence: 50,
    };
  }

  const last = list[list.length - 1].result;

  let streak = 1;

  for (let i = list.length - 2; i >= 0; i--) {
    if (list[i].result === last) streak++;
    else break;
  }

  if (streak >= 3) {
    return {
      prediction: last === "tài" ? "xỉu" : "tài",
      confidence: 80,
    };
  }

  return {
    prediction: last,
    confidence: 60,
  };
}

function trendPredict(list) {
  if (list.length < 6) {
    return {
      prediction: "tài",
      confidence: 50,
    };
  }

  const recent = list.slice(-6);

  let score = 0;

  recent.forEach((i) => {
    if (i.result === "tài") score++;
    else score--;
  });

  if (score > 0) {
    return {
      prediction: "tài",
      confidence: 70,
    };
  }

  return {
    prediction: "xỉu",
    confidence: 70,
  };
}

function markovPredict(list) {
  if (list.length < 2) {
    return {
      prediction: "tài",
      confidence: 50,
    };
  }

  const last = list[list.length - 1].result;

  let same = 0;
  let change = 0;

  for (let i = 1; i < list.length; i++) {
    if (list[i - 1].result === last) {
      if (list[i].result === last) same++;
      else change++;
    }
  }

  if (change > same) {
    return {
      prediction: last === "tài" ? "xỉu" : "tài",
      confidence: 75,
    };
  }

  return {
    prediction: last,
    confidence: 75,
  };
}

/* =========================
   GỘP THUẬT TOÁN
========================= */

function superPredict(list) {
  const algorithms = [
    frequencyPredict(list),
    streakPredict(list),
    trendPredict(list),
    markovPredict(list),
  ];

  let taiScore = 0;
  let xiuScore = 0;

  algorithms.forEach((algo) => {
    if (algo.prediction === "tài") {
      taiScore += algo.confidence;
    } else {
      xiuScore += algo.confidence;
    }
  });

  const finalPrediction =
    taiScore > xiuScore ? "tài" : "xỉu";

  const confidence = Math.min(
    99,
    Math.floor(
      Math.max(taiScore, xiuScore) /
        algorithms.length
    )
  );

  return {
    prediction: finalPrediction,
    confidence,
  };
}

/* =========================
   LOAD API
========================= */

async function loadData() {
  try {
    const response = await axios.get(API_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });

    const data =
      response.data?.data ||
      response.data?.sessions ||
      response.data;

    if (!Array.isArray(data)) {
      return null;
    }

    history = data
      .map((item) => {
        const dices = [
          Number(item.d1 || item.dice1 || 1),
          Number(item.d2 || item.dice2 || 1),
          Number(item.d3 || item.dice3 || 1),
        ];

        const total =
          dices[0] + dices[1] + dices[2];

        return {
          id: item.id || "s2king",
          session:
            item.session ||
            item.sid ||
            item.issue ||
            0,
          result: getTaiXiu(total),
          dices,
          total,
        };
      })
      .reverse();

    return history;
  } catch (err) {
    console.log("API ERROR:", err.message);
    return null;
  }
}

/* =========================
   API CHÍNH
========================= */

app.get("/", async (req, res) => {
  const data = await loadData();

  if (!data || data.length === 0) {
    return res.send("Không lấy được dữ liệu");
  }

  const last = data[data.length - 1];

  const predict = superPredict(data);

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
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log("Server running:", PORT);
});