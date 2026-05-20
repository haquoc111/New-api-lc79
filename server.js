const express = require('express');
const crypto = require('crypto');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   THUẬT TOÁN PHÂN TÍCH MD5
========================= */

function analyzeMD5(md5) {

    let scoreTai = 0;
    let scoreXiu = 0;

    const numbers = md5.replace(/[a-f]/g, '');
    const letters = md5.replace(/[0-9]/g, '');

    let even = 0;
    let odd = 0;

    // PHÂN TÍCH CHẴN LẺ
    for (let c of numbers) {

        let n = parseInt(c);

        if (n % 2 === 0) {
            even++;
        } else {
            odd++;
        }
    }

    if (even > odd) {
        scoreTai += 20;
    } else {
        scoreXiu += 20;
    }

    // PHÂN TÍCH HEX
    const heavyLetters = ['a', 'c', 'e'];
    const lightLetters = ['b', 'd', 'f'];

    for (let c of letters) {

        if (heavyLetters.includes(c)) {
            scoreTai += 2;
        }

        if (lightLetters.includes(c)) {
            scoreXiu += 2;
        }
    }

    // PHÂN TÍCH ASCII
    let asciiTotal = 0;

    for (let c of md5) {
        asciiTotal += c.charCodeAt(0);
    }

    if (asciiTotal % 2 === 0) {
        scoreTai += 15;
    } else {
        scoreXiu += 15;
    }

    // PHÂN TÍCH NHIỄU
    let repeat = 0;

    for (let i = 0; i < md5.length - 1; i++) {

        if (md5[i] === md5[i + 1]) {
            repeat++;
        }
    }

    if (repeat >= 3) {
        scoreTai += 10;
    } else {
        scoreXiu += 10;
    }

    // TỔNG SỐ
    let totalNum = 0;

    for (let c of numbers) {
        totalNum += parseInt(c);
    }

    if (totalNum >= 50) {
        scoreTai += 25;
    } else {
        scoreXiu += 25;
    }

    // ĐẢO CHUỖI AI
    const reverse = md5.split('').reverse().join('');

    if (
        reverse.includes('a') ||
        reverse.includes('8') ||
        reverse.includes('f')
    ) {
        scoreTai += 10;
    } else {
        scoreXiu += 10;
    }

    // KẾT QUẢ
    const result =
        scoreTai >= scoreXiu
        ? 'Tài'
        : 'Xỉu';

    let confidence =
        Math.abs(scoreTai - scoreXiu);

    if (confidence > 100) {
        confidence = 100;
    }

    return {
        result,
        confidence,
        scoreTai,
        scoreXiu
    };
}

/* =========================
   RANDOM XÚC XẮC
========================= */

function randomDice() {

    const d1 =
        Math.floor(Math.random() * 6) + 1;

    const d2 =
        Math.floor(Math.random() * 6) + 1;

    const d3 =
        Math.floor(Math.random() * 6) + 1;

    const total = d1 + d2 + d3;

    return {

        dice: `${d1}-${d2}-${d3}`,

        total,

        ketqua:
            total >= 11
            ? 'tài'
            : 'xỉu'
    };
}

/* =========================
   API PREDICT
========================= */

app.get('/predict', async (req, res) => {

    try {

        const now =
            Date.now().toString();

        const md5 = crypto
            .createHash('md5')
            .update(now)
            .digest('hex');

        const ai = analyzeMD5(md5);

        const dice = randomDice();

        const data = {

            status: 'success',

            Id: 's2king',

            Phien:
                Math.floor(Date.now() / 1000),

            Ket_qua:
                dice.ketqua,

            Xuc_xac:
                dice.dice,

            Du_doan:
                ai.result,

            Do_tin_cay:
                ai.confidence + '%',

            md5
        };

        res.json(data);

    } catch (err) {

        console.log(err);

        res.json({

            status: 'error',

            message:
                'Không thể phân tích'
        });
    }
});

/* =========================
   GIAO DIỆN WEB
========================= */

app.get('/', (req, res) => {

    res.send(`

<!DOCTYPE html>
<html lang="vi">

<head>

<meta charset="UTF-8">

<meta name="viewport"
content="width=device-width, initial-scale=1.0">

<title>AI MD5 PREDICT</title>

<style>

*{
    margin:0;
    padding:0;
    box-sizing:border-box;
}

body{

    background:#050816;

    color:white;

    font-family:Arial;

    overflow-x:hidden;
}

.container{

    width:100%;

    max-width:700px;

    margin:auto;

    padding:20px;
}

.title{

    text-align:center;

    font-size:40px;

    margin-top:20px;

    color:#00ffcc;

    text-shadow:0 0 20px #00ffcc;
}

.card{

    margin-top:30px;

    background:rgba(255,255,255,0.05);

    border:1px solid rgba(255,255,255,0.1);

    border-radius:20px;

    padding:25px;

    box-shadow:0 0 30px rgba(0,255,255,0.2);
}

.pred{

    text-align:center;

    font-size:40px;

    margin-bottom:20px;

    font-weight:bold;
}

.tai{

    color:#00ff66;

    text-shadow:0 0 20px #00ff66;
}

.xiu{

    color:#ff4444;

    text-shadow:0 0 20px #ff4444;
}

table{

    width:100%;

    border-collapse:collapse;

    margin-top:20px;
}

th,td{

    padding:15px;

    border-bottom:
    1px solid rgba(255,255,255,0.1);

    text-align:left;
}

th{

    background:
    rgba(255,255,255,0.05);
}

.loading{

    text-align:center;

    padding:30px;

    font-size:22px;
}

.md5{

    margin-top:20px;

    color:#00ffff;

    word-break:break-all;

    font-size:14px;
}

.btn{

    width:100%;

    margin-top:25px;

    padding:15px;

    border:none;

    border-radius:15px;

    background:#00ffaa;

    color:black;

    font-size:20px;

    font-weight:bold;

    cursor:pointer;

    transition:0.3s;
}

.btn:hover{

    transform:scale(1.03);

    background:#00ffcc;
}

.footer{

    margin-top:20px;

    text-align:center;

    color:#999;
}

</style>

</head>

<body>

<div class="container">

    <div class="title">
        AI MD5 PREDICT
    </div>

    <div class="card">

        <div id="predictionArea">

            <div class="loading">
                🔄 Đang tải AI...
            </div>

        </div>

        <button
        class="btn"
        onclick="fetchPrediction()">

            PHÂN TÍCH AI

        </button>

    </div>

    <div class="footer">
        POWER BY S2KING AI
    </div>

</div>

<script>

async function fetchPrediction() {

    const area =
    document.getElementById(
        'predictionArea'
    );

    try {

        area.innerHTML = \`
        <div class="loading">
            🔄 AI đang phân tích...
        </div>
        \`;

        const res =
        await fetch('/predict');

        if (!res.ok) {
            throw new Error(
                'API ERROR'
            );
        }

        const data =
        await res.json();

        if (
            data.status === 'success'
        ) {

            area.innerHTML = \`

            <div class="pred">

                🎯 DỰ ĐOÁN:

                <span class="\${
                    data.Du_doan === 'Tài'
                    ? 'tai'
                    : 'xiu'
                }">

                    \${data.Du_doan}

                </span>

            </div>

            <table>

                <tr>
                    <th>Thông tin</th>
                    <th>Giá trị</th>
                </tr>

                <tr>
                    <td>Id</td>
                    <td>\${data.Id}</td>
                </tr>

                <tr>
                    <td>Phiên</td>
                    <td>\${data.Phien}</td>
                </tr>

                <tr>
                    <td>Kết quả</td>
                    <td>\${data.Ket_qua}</td>
                </tr>

                <tr>
                    <td>Xúc xắc</td>
                    <td>\${data.Xuc_xac}</td>
                </tr>

                <tr>
                    <td>Dự đoán</td>
                    <td>\${data.Du_doan}</td>
                </tr>

                <tr>
                    <td>Độ tin cậy</td>
                    <td>\${data.Do_tin_cay}</td>
                </tr>

            </table>

            <div class="md5">

                🔐 MD5:
                \${data.md5}

            </div>

            \`;

        } else {

            area.innerHTML = \`

            <div class="loading">

                ❌
                \${data.message}

            </div>

            \`;
        }

    } catch (e) {

        console.log(e);

        area.innerHTML = \`

        <div class="loading">

            ❌ Không thể lấy dữ liệu

            <br><br>

            \${e.message}

        </div>

        \`;
    }
}

// LOAD TỰ ĐỘNG
setTimeout(() => {
    fetchPrediction();
}, 2000);

// AUTO REFRESH
setInterval(() => {
    fetchPrediction();
}, 10000);

</script>

</body>
</html>

    `);
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {

    console.log(
        'Server chạy tại cổng ' + PORT
    );
});