// ============================================================================
//  /api/gas — LỚP ĐỆM ĐỌC (miễn phí) đặt trước Apps Script
// ----------------------------------------------------------------------------
//  Mục đích: với vài hàm ĐỌC không tham số và ít đổi, Vercel giữ kết quả ở
//  máy chủ biên (CDN) và trả cho mọi người trong vài chục giây. Nhờ vậy khi
//  đông người cùng mở app, Apps Script KHÔNG phải chạy lại cho từng người.
//
//  Nguyên tắc an toàn:
//   - CHỈ những hàm nằm trong bảng CHO_PHEP mới đi qua đây (đều không có tham
//     số, không chứa dữ liệu riêng của ai).
//   - Hàm ghi / hàm cần token: KHÔNG đệm, vẫn gọi thẳng Apps Script như cũ.
//   - Lỗi thì trả 502 kèm "no-store" (không cache lỗi); phía app tự gọi thẳng
//     Apps Script nên không bao giờ bị kẹt vì lớp đệm này.
// ============================================================================

// Giống hệt window.GAS_URL trong config.js (đổi file kia thì đổi cả đây).
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbxgKaYg-5fBvx1r4_pU4316aCe-tBWVGNL4VBVQgyotsahs3AQ6Ou6ck9k4IhQV2k2G/exec";

// ttl  = số giây máy chủ biên giữ bản cũ
// swr  = số giây được phép trả bản cũ trong lúc ngầm lấy bản mới
const CHO_PHEP = {
  // Trạng thái bảo trì: cần tươi để bật/tắt nhanh (tối đa ~30 giây là thấy).
  layTrangThaiBaoTri: { ttl: 15, swr: 15 },
  // Thông báo chạy + đếm ngược sự kiện (Admin sửa trong CAU_HINH_APP).
  getAppConfigData: { ttl: 120, swr: 600 },
  // Hành trình: gần như chỉ thêm mỗi lần có chuyến mới.
  getHanhTrinhData: { ttl: 600, swr: 3600 },
};

// Gọi Apps Script đúng cách đang dùng ở app: POST JSON, tự theo 302 sang
// googleusercontent (fetch tự đổi POST -> GET khi gặp 302, đúng như trình duyệt).
async function goiAppsScript(fn) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ fn, args: [] }),
      redirect: "follow",
      signal: ctrl.signal,
    });
    const txt = await r.text();
    if (!r.ok) throw new Error("Apps Script trả về HTTP " + r.status);
    return JSON.parse(txt); // { ok: true, result: ... }
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const fn = String((req.query && req.query.fn) || "").trim();
  const cfg = Object.prototype.hasOwnProperty.call(CHO_PHEP, fn) ? CHO_PHEP[fn] : null;

  if (req.method !== "GET") {
    res.status(405).setHeader("Cache-Control", "no-store").json({ ok: false, error: "Chỉ nhận GET" });
    return;
  }
  if (!cfg) {
    res.status(400).setHeader("Cache-Control", "no-store").json({ ok: false, error: "Hàm không được đệm: " + fn });
    return;
  }

  try {
    const kq = await goiAppsScript(fn);
    if (!kq || !kq.ok) {
      res.status(502).setHeader("Cache-Control", "no-store")
        .json({ ok: false, error: (kq && kq.error) || "Máy chủ trả về lỗi" });
      return;
    }
    res.setHeader("Cache-Control", "public, s-maxage=" + cfg.ttl + ", stale-while-revalidate=" + cfg.swr);
    res.status(200).json(kq);
  } catch (e) {
    res.status(502).setHeader("Cache-Control", "no-store")
      .json({ ok: false, error: String((e && e.message) || e) });
  }
};
