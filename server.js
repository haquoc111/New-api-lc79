// server.js
import fetch from 'node-fetch';
import crypto from 'crypto';
import express from 'express';

const app = express();
app.use(express.json());

// ==================== HÀM DỰ ĐOÁN MD5 (giữ nguyên code của bạn) ====================
function duDoanDinhCao(md5, lichSu15) {
    let bytes = [];
    for (let i = 0; i < 32; i += 2) bytes.push(parseInt(md5.substr(i, 2), 16));
    let tong = bytes.reduce((a, b) => a + b, 0);
    let tb = tong / 16;
    let ps = 0;
    for (let b of bytes) ps += (b - tb) ** 2;
    ps /= 16;
    let entropy = 0;
    let dem = {};
    for (let b of bytes) dem[b] = (dem[b] || 0) + 1;
    for (let k in dem) { let p = dem[k] / 16; entropy -= p * Math.log2(p); }
    let md5Score = 0;
    if (tong % 6 >= 3) md5Score += 0.25;
    if (bytes[0] > 220 && bytes[15] < 70) md5Score += 0.35;
    if (bytes[15] < 30 && ps > 3500) md5Score -= 0.4;
    if (entropy > 3.6) md5Score -= 0.2;
    if (ps < 2000) md5Score += 0.2;
    let thongKe = { T: 0, X: 0 };
    for (let k of lichSu15) thongKe[k]++;
    let tiLeTai = thongKe.T / 15;
    let maxLap = 1, lapHT = 1, cau11 = 0, cauNgich = 0;
    for (let i = 1; i < lichSu15.length; i++) {
        if (lichSu15[i] === lichSu15[i - 1]) { lapHT++; if (lapHT > maxLap) maxLap = lapHT; }
        else { lapHT = 1; }
        if (i >= 2 && lichSu15[i] !== lichSu15[i - 1] && lichSu15[i - 1] !== lichSu15[i - 2]) cau11++;
        if (i >= 2 && lichSu15[i] === lichSu15[i - 2] && lichSu15[i] !== lichSu15[i - 1]) cauNgich++;
    }
    let last3 = lichSu15.slice(-3);
    let cauThuan = (last3[0] === last3[1] && last3[1] === last3[2]) ? 2 : (last3[0] === last3[1] || last3[1] === last3[2]) ? 1 : 0;
    let cauScore = 0;
    if (maxLap >= 4) cauScore = (lichSu15[lichSu15.length - 1] === "T") ? 0.8 : -0.8;
    else if (cau11 >= 5) cauScore = (lichSu15[lichSu15.length - 1] === "T") ? -0.7 : 0.7;
    else if (cauNgich >= 4) cauScore = (lichSu15[lichSu15.length - 1] === "T") ? 0.6 : -0.6;
    else if (tiLeTai > 0.65) cauScore = -0.5;
    else if (tiLeTai < 0.35) cauScore = 0.5;
    else cauScore = (cauThuan === 2) ? 0.4 : (cauThuan === 1) ? 0.2 : 0;
    let finalScore = md5Score * 0.4 + cauScore * 0.6;
    let randomFactor = (bytes[8] % 100) / 100;
    let duDoan = "";
    let doTin = 0;
    if (Math.abs(finalScore) > 0.45) {
        duDoan = finalScore > 0 ? "TAI" : "XIU";
        doTin = 70 + Math.abs(finalScore) * 50;
    } else if (Math.abs(finalScore) > 0.2) {
        duDoan = finalScore > 0 ? "TAI" : "XIU";
        doTin = 55 + Math.abs(finalScore) * 40;
    } else {
        duDoan = randomFactor > 0.55 ? "TAI" : "XIU";
        doTin = 50 + Math.abs(randomFactor - 0.5) * 30;
    }
    if (maxLap >= 6) doTin = Math.min(96, doTin + 15);
    if (cau11 >= 8) doTin = Math.min(96, doTin + 12);
    if (tiLeTai > 0.8 || tiLeTai < 0.2) doTin = Math.min(96, doTin + 10);
    return { duDoan: duDoan, doTinCay: Math.round(doTin), md5Score: md5Score, cauScore: cauScore };
}

// ==================== HÀM GỌI API VÀ XỬ LÝ DỮ LIỆU ====================
// URL API cố định
const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=2cff2322cadccdcb7afd52aa2f828f83';

// Hàm tạo mã MD5 từ chuỗi đầu vào
function taoMd5(input) {
    return crypto.createHash('md5').update(String(input)).digest('hex');
}

// Biến lưu trữ dữ liệu dự đoán mới nhất
let duLieuMoiNhat = null;
let dangXuLy = false;

// Hàm lấy dữ liệu từ API và tính toán dự đoán
async function capNhatDuLieu() {
    if (dangXuLy) return; // Tránh gọi chồng lấp
    dangXuLy = true;
    try {
        console.log('🔄 Đang lấy dữ liệu từ API...');
        const response = await fetch(API_URL);
        if (!response.ok) {
            throw new Error(`API trả về lỗi: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();

        // Kiểm tra cấu trúc dữ liệu
        if (!data || !Array.isArray(data.list) || data.list.length === 0) {
            throw new Error('Dữ liệu API không hợp lệ hoặc rỗng');
        }

        // Lấy 15 phiên gần nhất
        const danhSachPhien = data.list.slice(0, 15);
        const lichSu15 = danhSachPhien.map(item => {
            // Chuyển đổi kết quả về định dạng "T" hoặc "X"
            return item.resultTruyenThong === 'TAI' ? 'T' : 'X';
        });

        // Lấy mã MD5 của phiên hiện tại (phiên đầu tiên trong danh sách)
        const phienHienTai = danhSachPhien[0];
        const idPhien = phienHienTai.id;
        const md5Phien = taoMd5(idPhien);

        // Tính toán dự đoán
        const ketQuaDuDoan = duDoanDinhCao(md5Phien, lichSu15);

        // Định dạng lại kết quả cho dễ đọc
        const xucXac = phienHienTai.dices.join('-');
        const ketQua = phienHienTai.resultTruyenThong;

        // Lưu kết quả dự đoán
        duLieuMoiNhat = {
            Id: 's2king',
            Phien: idPhien,
            Ket_qua: ketQua.toLowerCase(),
            Xuc_xac: xucXac,
            Phien_hien_tai: idPhien + 1, // Giả định phiên tiếp theo
            Du_doan: ketQuaDuDoan.duDoan.toLowerCase(),
            Do_tin_cay: ketQuaDuDoan.doTinCay + '%'
        };

        console.log('✅ Dự đoán mới:', duLieuMoiNhat);
    } catch (error) {
        console.error('❌ Lỗi khi cập nhật dữ liệu:', error.message);
    } finally {
        dangXuLy = false;
    }
}

// ==================== KHỞI ĐỘNG SERVER ====================
const PORT = process.env.PORT || 3000;

// Endpoint chính để lấy dữ liệu dự đoán
app.get('/', (req, res) => {
    if (duLieuMoiNhat) {
        res.json(duLieuMoiNhat);
    } else {
        res.status(503).json({
            error: 'Dữ liệu chưa sẵn sàng',
            message: 'Server đang khởi động, vui lòng thử lại sau vài giây'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Lấy dữ liệu lần đầu khi khởi động
capNhatDuLieu();

// Cập nhật dữ liệu mỗi 15 giây
const interval = setInterval(capNhatDuLieu, 15000);

// Xử lý tắt server an toàn
process.on('SIGINT', () => {
    console.log('🛑 Đang tắt server...');
    clearInterval(interval);
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 Đang tắt server...');
    clearInterval(interval);
    process.exit(0);
});

app.listen(PORT, () => {
    console.log(`🚀 Server dự đoán MD5 đang chạy tại http://localhost:${PORT}`);
    console.log(`📊 Dữ liệu được cập nhật mỗi 15 giây từ API`);
});