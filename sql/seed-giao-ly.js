// ============================================================================
//  seed-giao-ly.js — xuất dữ liệu Giáo Lý hiện có sang file SQL
// ----------------------------------------------------------------------------
//  Chạy 1 lần, TRƯỚC khi bật window.SQL_CHE_DO = "sql":
//
//    node sql/seed-giao-ly.js
//
//  Biến môi trường:
//    ADMIN_TOKEN  (bắt buộc) token Admin đang dùng trong app.
//                 Lấy trong trình duyệt, console:
//                   JSON.parse(localStorage.getItem('xd_phien_v1')).token
//    GAS_URL      (tuỳ chọn) mặc định đúng URL deployed hiện tại.
//
//  Kết quả: sql/giao_ly_seed.sql — mở bằng Supabase SQL Editor -> Run.
//  Không ghi ngược vào Google Sheet.
// ============================================================================

const fs = require("fs");
const path = require("path");

const GAS_URL = String(process.env.GAS_URL ||
  "https://script.google.com/macros/s/AKfycbxgKaYg-5fBvx1r4_pU4316aCe-tBWVGNL4VBVQgyotsahs3AQ6Ou6ck9k4IhQV2k2G/exec");
const TOKEN = String(process.env.ADMIN_TOKEN || "").trim();

if (!TOKEN) {
  console.error("Thiếu ADMIN_TOKEN. Lấy trong console trình duyệt:\n  JSON.parse(localStorage.getItem('xd_phien_v1')).token");
  process.exit(1);
}

async function goi(fn, args) {
  const r = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ fn, args: args || [] }),
    redirect: "follow",
  });
  const j = await r.json();
  if (!j.ok) throw new Error((j && j.error) || "Lỗi gọi " + fn);
  return j.result;
}

const q = (v) => "'" + String(v == null ? "" : v).replace(/'/g, "''") + "'";
const n = (v) => Number(v) || 0;

(async function () {
  // Danh sách lớp vẫn lấy từ CSDL gốc qua Apps Script, rồi lưu snapshot vào
  // bảng lop_giao_ly (chỉ đọc) để chế độ SQL không phải gọi Google mỗi lần.
  const kqLop = await goi("admLayDanhSachLopGiaoLy", [TOKEN]);
  const dsLop = (kqLop && kqLop.success && Array.isArray(kqLop.list)) ? kqLop.list : [];
  const maLops = [""].concat(dsLop.map((l) => String(l.maLop || "")))
    .filter((x, i, a) => a.indexOf(x) === i);
  const rowsLop = dsLop.map((l) => "(" + [
    q(l.maLop), q(l.ten || l.maLop), q(l.khoi), q(l.nienKhoa),
    q(l.phong), q(l.lich), n(l.siSo), q(l.ghiChu), q("CSDL"),
  ].join(",") + ")");

  let cfg = null;
  const rowsBai = new Map();
  const rowsLich = [];
  const rowsNghi = [];

  for (const ma of maLops) {
    const res = await goi("admGiaoLyLayDuLieu", [TOKEN, ma]);
    if (!res || !res.success) continue;
    if (!cfg) cfg = res;

    (res.dsBai || []).forEach((b) => {
      rowsBai.set(b.maBai, [
        q(b.maBai), q(b.maLop), q(b.tenBai), q(b.chuDe), q(b.mucTieu),
        q(b.noiDung), q(b.taiLieu), n(b.thuTu), q(b.maGLV),
        q(b.ngayTao), q(b.ngayCapNhat),
      ].join(","));
    });

    (res.dsBaiDaXep || []).forEach((b) => {
      if (!b.ngayGoc) return;
      rowsLich.push("(" + [q(ma), q(b.maBai), q(b.ngayGoc), q(b.ngayGoc), q("hoc")].join(",") + ")");
    });

    (res.dsTuan || []).forEach((t) => {
      if (!t.ngay || t.trangThai === "hoc") return;
      rowsNghi.push("(" + [q(ma), q(t.ngay), q(t.trangThai), q(t.ghiChu), q(t.nguoi), q(t.luc)].join(",") + ")");
    });
  }

  if (!cfg) throw new Error("Không đọc được dữ liệu Giáo Lý. Kiểm tra lại ADMIN_TOKEN có phải Admin không.");

  const out = [];
  out.push("-- Seed Giáo Lý xuất từ Google Sheet " + new Date().toISOString());
  out.push("begin;");
  if (rowsLop.length) {
    out.push("insert into lop_giao_ly(ma_lop,ten_lop,khoi,nien_khoa,phong_hoc,lich_hoc,si_so_du_kien,ghi_chu,nguon) values");
    out.push(rowsLop.join(",\n") + " on conflict (ma_lop) do update set " +
      "ten_lop=excluded.ten_lop, khoi=excluded.khoi, nien_khoa=excluded.nien_khoa, " +
      "phong_hoc=excluded.phong_hoc, lich_hoc=excluded.lich_hoc, " +
      "si_so_du_kien=excluded.si_so_du_kien, ghi_chu=excluded.ghi_chu, nguon=excluded.nguon, " +
      "cap_nhat_luc=now();");
  }
  out.push("insert into cau_hinh(khoa, gia_tri) values " +
    "('NAM_HOC_BAT_DAU'," + q(cfg.namHocBatDau) + "),('NAM_HOC_KET_THUC'," + q(cfg.namHocKetThuc) + ") " +
    "on conflict (khoa) do update set gia_tri = excluded.gia_tri;");

  if (rowsBai.size) {
    out.push("insert into bai_day(ma_bai,ma_lop,ten_bai,chu_de,muc_tieu,noi_dung,tai_lieu,thu_tu,ma_glv,ngay_tao,ngay_cap_nhat) values");
    out.push(Array.from(rowsBai.values()).map((r) => "(" + r + ")").join(",\n") + ";");
  }
  if (rowsLich.length) {
    out.push("insert into lich_giao_ly_tuan(ma_lop,ma_bai,ngay,ngay_goc,trang_thai) values");
    out.push(Array.from(new Set(rowsLich)).join(",\n") + " on conflict (ma_lop,ma_bai) do nothing;");
  }
  if (rowsNghi.length) {
    out.push("insert into tuan_nghi(ma_lop,ngay,trang_thai,ghi_chu,nguoi,luc) values");
    out.push(Array.from(new Set(rowsNghi)).join(",\n") + " on conflict (ma_lop,ngay) do update set " +
      "trang_thai=excluded.trang_thai, ghi_chu=excluded.ghi_chu, nguoi=excluded.nguoi, luc=excluded.luc;");
  }
  out.push("commit;");

  const file = path.join(__dirname, "giao_ly_seed.sql");
  fs.writeFileSync(file, out.join("\n"), "utf8");
  console.log("Đã ghi " + file);
  console.log("lớp: " + rowsLop.length + " · bài: " + rowsBai.size +
    " · lịch: " + new Set(rowsLich).size + " · tuần nghỉ: " + new Set(rowsNghi).size);
})().catch((e) => { console.error(e.message); process.exit(1); });
