// ============================================================================
//  /api/sql — backend SQL cho app (chế độ HYBRID)
// ----------------------------------------------------------------------------
//  Nhận đúng envelope của Apps Script: POST {fn, args} -> {ok, result}.
//  Giữ NGUYÊN tên hàm nên index.html không phải sửa.
//
//  Không dùng npm: gọi Supabase qua REST (PostgREST) bằng fetch có sẵn.
//  SUPABASE_SERVICE_ROLE_KEY chỉ nằm ở Vercel env, KHÔNG gửi xuống browser.
//
//  Biến môi trường cần đặt trên Vercel:
//    SUPABASE_URL                  (vd https://xxxx.supabase.co)
//    SUPABASE_SECRET_KEY           (key mới: sb_secret_...)
//      hoặc SUPABASE_SERVICE_ROLE_KEY (key cũ service_role, vẫn chấp nhận)
//    GAS_URL                       (tuỳ chọn, có sẵn default bên dưới)
// ============================================================================

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = String(
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);
const GAS_URL = String(process.env.GAS_URL ||
  "https://script.google.com/macros/s/AKfycbxgKaYg-5fBvx1r4_pU4316aCe-tBWVGNL4VBVQgyotsahs3AQ6Ou6ck9k4IhQV2k2G/exec");

const SESSION_MS = 30 * 24 * 3600 * 1000;
const TRANG_THAI_TUAN = ["hoc", "nghi_dạy", "nghi_hoc", "glv_xin_nghi"];

// fn -> quyền. 'write' để shim KHÔNG tự gọi lại Apps Script khi lỗi (tránh ghi trùng).
const SQL_FN = {
  xdSqlPing:                  { auth: null,    write: false },
  admGiaoLyLayDuLieu:         { auth: "admin", write: false },
  glvLayTienDo:               { auth: "glv",   write: false },
  admGiaoLyLuuNamHoc:         { auth: "admin", write: true },
  admGiaoLyLuuBai:            { auth: "admin", write: true },
  admGiaoLyXoaBai:            { auth: "admin", write: true },
  admGiaoLyDatLich:           { auth: "admin", write: true },
  admGiaoLyBoLich:            { auth: "admin", write: true },
  admGiaoLyCapNhatTuan:       { auth: "admin", write: true },
};

function loi(message, code) {
  const e = new Error(String(message || "Lỗi SQL"));
  if (code) e.code = code;
  return e;
}

// ---------- Supabase REST ----------
async function db(table, opt) {
  const o = opt || {};
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw loi("Chưa cấu hình SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trên Vercel.", "CHUA_CAU_HINH");
  }
  const qs = o.query ? "?" + o.query : "";
  const headers = {
    apikey: SERVICE_KEY,
    "Content-Type": "application/json",
  };
  // Key mới (sb_secret_ / sb_publishable_) KHÔNG phải JWT: chỉ gửi ở apikey.
  // Gửi thêm Authorization: Bearer sẽ khiến PostgREST thử verify JWT và trả 401.
  // Key cũ service_role (eyJ...) thì bắt buộc phải có Authorization Bearer.
  if (/^eyJ/.test(SERVICE_KEY)) headers.Authorization = "Bearer " + SERVICE_KEY;
  if (o.prefer) headers.Prefer = o.prefer;

  const r = await fetch(SUPABASE_URL + "/rest/v1/" + table + qs, {
    method: o.method || "GET",
    headers,
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    redirect: "follow",
  });
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  if (!r.ok) throw loi("Supabase " + r.status + ": " + (typeof data === "string" ? data : JSON.stringify(data)));
  return data;
}

const chonTatCa = (table) => db(table, { query: "select=*" });

async function upsert(table, row, khoa) {
  const q = khoa ? "on_conflict=" + khoa : "";
  return db(table, {
    method: "POST", query: q, body: row,
    prefer: "resolution=merge-duplicates,return=representation",
  });
}

// ---------- Xác thực token ----------
// Token do Apps Script cấp. Lần đầu gặp thì hỏi Apps Script 1 lần (hàm
// xdXacThucSQL nằm ở API.txt), sau đó lưu copy vào Postgres để các lần sau
// không phải gọi lại Google — đây là chỗ tiết kiệm lớn nhất về tốc độ.
async function goiAppsScript(fn, args) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ fn, args: args || [] }),
      redirect: "follow",
      signal: ctrl.signal,
    });
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function xacThuc(token, loaiCan) {
  const tokenS = String(token || "").trim();
  if (!tokenS) throw loi("Chưa có phiên đăng nhập.", "HET_PHIEU");
  const loai = loaiCan === "glv" ? "GLV" : "HT";
  const now = Date.now();

  let hang = null;
  try {
    const ds = await db("phien_dang_nhap", {
      query: "select=*&token=eq." + encodeURIComponent(tokenS),
    });
    hang = ds && ds[0];
  } catch (e) { throw e; }

  if (!hang || Number(hang.het_han_ms || 0) <= now || hang.loai !== loai) {
    let kq = null;
    try { kq = await goiAppsScript("xdXacThucSQL", [tokenS, loai]); }
    catch (e) { throw loi("Không xác thực được phiên đăng nhập: " + e.message, "HET_PHIEU"); }
    if (!kq || !kq.ok || !kq.result || !kq.result.hopLe) {
      throw loi("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại!", "HET_PHIEU");
    }
    const r = kq.result;
    hang = {
      token: tokenS, loai: r.loai, ma: r.ma, ten: r.ten || "",
      is_admin: !!r.isAdmin, het_han_ms: now + SESSION_MS,
    };
    await upsert("phien_dang_nhap", hang, "token");
  }

  if (loaiCan === "admin" && (hang.loai !== "HT" || !hang.is_admin)) {
    throw loi("Bạn không có quyền quản lý bài dạy & lịch trình.", "KHONG_QUYEN");
  }
  return hang;
}

// ---------- Tiện ích ngày (khớp CODE.txt) ----------
function ngayTuIso(iso) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(iso || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}
function isoTuNgay(d) {
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
}
function denIso(d) { return isoTuNgay(d); }
function congTuan(iso, n) {
  const d = ngayTuIso(iso);
  if (!d) return String(iso || "");
  d.setDate(d.getDate() + 7 * Number(n || 0));
  return denIso(d);
}
function ngayVn(iso) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(iso || ""));
  return m ? ("0" + m[3]).slice(-2) + "/" + ("0" + m[2]).slice(-2) + "/" + m[1] : "";
}
function chuaNhatDauTien(batDau) {
  const d = ngayTuIso(batDau);
  if (!d) return "";
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return denIso(d);
}
function danhSachChuaNhat(batDau, ketThuc) {
  const dau = chuaNhatDauTien(batDau);
  if (!dau || !ngayTuIso(batDau)) return [];
  let ket = String(ketThuc || "").trim();
  const y = Number(String(batDau).slice(0, 4));
  if (!ngayTuIso(ket) || ket < batDau) ket = (y + 1) + "-08-31";
  const ds = [];
  let cur = dau;
  for (let i = 0; i < 260; i++) {
    if (cur > ket) break;
    ds.push(cur);
    cur = congTuan(cur, 1);
  }
  return ds;
}

// ---------- Đọc dữ liệu Giáo Lý ----------
async function duLieuGl() {
  const [cfgRows, baiRows, lichRows, nghiRows, lopRows] = await Promise.all([
    chonTatCa("cau_hinh"),
    chonTatCa("bai_day"),
    chonTatCa("lich_giao_ly_tuan"),
    chonTatCa("tuan_nghi"),
    chonTatCa("lop_giao_ly"),
  ]);

  const cfg = {};
  (cfgRows || []).forEach((r) => { cfg[r.khoa] = r.gia_tri; });

  const homNay = denIso(new Date());
  const namBatDau = /^\d{4}-\d{2}-\d{2}$/.test(String(cfg.NAM_HOC_BAT_DAU || ""))
    ? cfg.NAM_HOC_BAT_DAU : new Date().getFullYear() + "-09-01";
  const y = Number(namBatDau.slice(0, 4));
  const namKetThuc = /^\d{4}-\d{2}-\d{2}$/.test(String(cfg.NAM_HOC_KET_THUC || ""))
    ? cfg.NAM_HOC_KET_THUC : (y + 1) + "-08-31";
  const dsTuanNgay = danhSachChuaNhat(namBatDau, namKetThuc);

  const dsBai = (baiRows || []).map((r) => ({
    maBai: String(r.ma_bai || "").trim().toUpperCase(),
    maLop: String(r.ma_lop || "").trim().toUpperCase(),
    tenBai: String(r.ten_bai || ""),
    chuDe: String(r.chu_de || ""), mucTieu: String(r.muc_tieu || ""),
    noiDung: String(r.noi_dung || ""), taiLieu: String(r.tai_lieu || ""),
    thuTu: Number(r.thu_tu) || 0,
    maGLV: String(r.ma_glv || ""),
    ngayTao: String(r.ngay_tao || ""), ngayCapNhat: String(r.ngay_cap_nhat || ""),
  })).sort((a, b) => a.thuTu - b.thuTu);

  const dsLich = (lichRows || []).map((r) => ({
    maLop: String(r.ma_lop || "").trim().toUpperCase(),
    ngay: String(r.ngay || "").slice(0, 10),
    maBai: String(r.ma_bai || "").trim().toUpperCase(),
    ghiChu: String(r.ghi_chu || ""), nguoi: String(r.nguoi || ""), luc: String(r.luc || ""),
    ngayGoc: String(r.ngay_goc || "").slice(0, 10),
  }));

  const nghi = {};
  (nghiRows || []).forEach((r) => {
    const ml = String(r.ma_lop || "").trim().toUpperCase();
    const ngay = String(r.ngay || "").slice(0, 10);
    if (!ngay) return;
    nghi[ml + "|" + ngay] = {
      trangThai: r.trang_thai || "nghi_dạy", ghiChu: r.ghi_chu || "",
      nguoi: r.nguoi || "", luc: r.luc || "",
    };
  });

  const dsLop = (lopRows || []).map((r) => ({
    maLop: String(r.ma_lop || "").trim().toUpperCase(),
    ten: String(r.ten_lop || ""),
  })).filter((l) => l.maLop);

  return { cfg, namBatDau, namKetThuc, dsTuanNgay, dsBai, dsLich, nghi, dsLop, homNay };
}

function rutGonBai(b) {
  return {
    maBai: b.maBai, tenBai: b.tenBai, maLop: b.maLop, thuTu: b.thuTu,
    ngayGoc: b.ngayGoc, ngay: b.ngay, ngayVn: b.ngayVn, tuan: b.tuan,
    don: b.don, daDay: b.daDay, chuaLich: b.chuaLich,
  };
}

// CộT lịch + dồn bài: port trực tiếp _glvTinhLich() của CODE.txt.
function tinhLich(maLop, duLieu) {
  const maLopU = String(maLop || "").trim().toUpperCase();
  const { dsBai, dsLich, nghi, dsTuanNgay, homNay } = duLieu;
  const danhMuc = {};
  dsBai.forEach((b) => { danhMuc[b.maBai] = b; });

  const nghiHoc = {};
  Object.keys(nghi).forEach((k) => {
    const p = k.split("|");
    if (p[0] === "") nghiHoc[p[1]] = nghi[k];
  });
  Object.keys(nghi).forEach((k) => {
    const p = k.split("|");
    if (p[0] === maLopU) nghiHoc[p[1]] = nghi[k];
  });

  const tapTuan = {}, dsTuan = [];
  dsTuanNgay.forEach((ngay, idx) => {
    const n = nghiHoc[ngay] || null;
    const t = {
      ngay, ngayVn: ngayVn(ngay), tuan: idx + 1,
      trangThai: n ? n.trangThai : "hoc", ghiChu: n ? n.ghiChu : "",
      nguoi: n ? n.nguoi : "", luc: n ? n.luc : "",
      daQua: ngay < homNay, laHomNay: ngay === homNay, dsBai: [],
    };
    tapTuan[ngay] = t;
    dsTuan.push(t);
  });

  const phanCong = [];
  dsLich.forEach((r, idx) => {
    if (r.maLop && r.maLop !== maLopU) return;
    const bai = danhMuc[r.maBai];
    if (!bai) return;
    if (bai.maLop && bai.maLop !== maLopU) return;
    phanCong.push({
      goc: r.ngayGoc || r.ngay, thuTu: bai.thuTu || 0, dong: idx, bai,
      ghiChu: r.ghiChu, nguoi: r.nguoi, luc: r.luc,
    });
  });
  phanCong.sort((a, b) => {
    if (a.goc !== b.goc) return a.goc < b.goc ? -1 : 1;
    if (a.thuTu !== b.thuTu) return a.thuTu - b.thuTu;
    return a.dong - b.dong;
  });

  const daXep = {}, dsBaiXep = [];
  let soBaiDon = 0, soDaDay = 0;
  phanCong.forEach((pc) => {
    let viTri = 0;
    for (let i = 0; i < dsTuanNgay.length; i++) {
      if (dsTuanNgay[i] === pc.goc) { viTri = i; break; }
    }
    while (viTri < dsTuanNgay.length && nghiHoc[dsTuanNgay[viTri]]) viTri++;
    if (viTri >= dsTuanNgay.length) return;
    const ngay = dsTuanNgay[viTri];
    const don = ngay !== pc.goc;
    if (don) soBaiDon++;
    const daDay = ngay < homNay;
    if (daDay) soDaDay++;
    const item = {
      maBai: pc.bai.maBai, tenBai: pc.bai.tenBai, maLop: pc.bai.maLop,
      chuDe: pc.bai.chuDe, mucTieu: pc.bai.mucTieu, noiDung: pc.bai.noiDung,
      taiLieu: pc.bai.taiLieu, thuTu: pc.bai.thuTu,
      ngayGoc: pc.goc, ngay, ngayVn: ngayVn(ngay), tuan: tapTuan[ngay].tuan,
      don, daDay, chuaLich: false,
      ghiChu: pc.ghiChu, nguoi: pc.nguoi, luc: pc.luc,
    };
    dsBaiXep.push(item);
    tapTuan[ngay].dsBai.push(item);
    daXep[pc.bai.maBai] = true;
  });
  dsBaiXep.sort((a, b) => (a.ngay !== b.ngay ? (a.ngay < b.ngay ? -1 : 1) : a.thuTu - b.thuTu));
  dsTuan.forEach((t) => { t.dsBai.sort((a, b) => a.thuTu - b.thuTu); });

  const dsChuaXep = [];
  dsBai.forEach((b) => {
    if (b.maLop && b.maLop !== maLopU) return;
    if (daXep[b.maBai]) return;
    dsChuaXep.push({
      maBai: b.maBai, tenBai: b.tenBai, maLop: b.maLop,
      chuDe: b.chuDe, mucTieu: b.mucTieu, noiDung: b.noiDung,
      taiLieu: b.taiLieu, thuTu: b.thuTu,
      ngayGoc: "", ngay: "", ngayVn: "", tuan: 0,
      don: false, daDay: false, chuaLich: true,
      ghiChu: "", nguoi: "", luc: "",
    });
  });
  dsChuaXep.sort((a, b) => a.thuTu - b.thuTu);

  let soTuanNghi = 0;
  dsTuan.forEach((t) => { if (t.trangThai !== "hoc") soTuanNghi++; });
  const tongBai = dsBaiXep.length;
  return {
    homNay, dsTuan, dsBai: dsBaiXep.concat(dsChuaXep),
    dsBaiDaXep: dsBaiXep, tongBai, soDaDay,
    phanTram: tongBai ? Math.round(soDaDay * 100 / tongBai) : 0,
    soTuanNghi, soBaiDon,
  };
}

// ---------- CÁC HÀM CŨ (giữ nguyên tên) ----------
async function admGiaoLyLayDuLieu(args) {
  const token = args[0];
  const maLop = String(args[1] || "").trim().toUpperCase();
  await xacThuc(token, "admin");
  const dl = await duLieuGl();
  if (!dl.dsTuanNgay.length) return { success: false, error: "Khoảng niên khoá không hợp lệ." };

  const kq = tinhLich(maLop, dl);
  return {
    success: true, maLop,
    namHocBatDau: dl.namBatDau, namHocKetThuc: dl.namKetThuc,
    homNay: kq.homNay, tongTuan: dl.dsTuanNgay.length,
    dsLop: dl.dsLop, dsBai: dl.dsBai,
    dsTuan: kq.dsTuan.map((t) => Object.assign({}, t, { dsBai: t.dsBai.map(rutGonBai) })),
    dsBaiDaXep: kq.dsBaiDaXep.map(rutGonBai),
    tongBai: kq.tongBai, soDaDay: kq.soDaDay, phanTram: kq.phanTram,
    soTuanNghi: kq.soTuanNghi, soBaiDon: kq.soBaiDon,
  };
}

async function glvLayTienDo(args) {
  const token = args[0];
  const nguoi = await xacThuc(token, "glv");

  // Lớp của GLV: ưu tiên bảng nguoi_dung (đã import từ GIAO_LY_VIEN cột C),
  // fallback hỏi Apps Script (hàm getThongTinLopCuaGLV vẫn còn nguyên).
  let maLop = "", tenLop = "";
  const rows = await db("nguoi_dung", { query: "select=*&ma=eq." + encodeURIComponent(nguoi.ma) });
  const u = rows && rows[0];
  if (u && u.ma_lop) maLop = String(u.ma_lop).trim().toUpperCase();
  if (!maLop) {
    const kqLop = await goiAppsScript("getThongTinLopCuaGLV", [token]);
    if (kqLop && kqLop.ok && kqLop.result && kqLop.result.coLop) {
      maLop = String(kqLop.result.maLop || "").trim().toUpperCase();
      tenLop = String(kqLop.result.tenLop || "");
    }
  }
  if (!maLop) return { success: true, chiDoc: true, coLop: false };

  const dl = await duLieuGl();
  if (!dl.dsTuanNgay.length) return { success: false, error: "Chưa có lịch trình cho năm học này." };
  if (!tenLop) {
    const found = dl.dsLop.filter((l) => l.maLop === maLop)[0];
    tenLop = found ? found.ten : maLop;
  }
  const kq = tinhLich(maLop, dl);
  return {
    success: true, chiDoc: true, coLop: true, maLop, tenLop,
    namHocBatDau: dl.namBatDau, namHocKetThuc: dl.namKetThuc, homNay: kq.homNay,
    dsBai: kq.dsBai.map(rutGonBai),
    dsTuan: kq.dsTuan.map((t) => Object.assign({}, t, { dsBai: t.dsBai.map(rutGonBai) })),
    tongBai: kq.tongBai, soDaDay: kq.soDaDay, phanTram: kq.phanTram,
    soTuanNghi: kq.soTuanNghi, soBaiDon: kq.soBaiDon,
    tongTuan: dl.dsTuanNgay.length,
  };
}

async function admGiaoLyLuuNamHoc(args) {
  await xacThuc(args[0], "admin");
  const bd = String(args[1] || "").trim();
  const kt = String(args[2] || "").trim();
  if (!ngayTuIso(bd) || !/^\d{4}-\d{2}-\d{2}$/.test(bd)) throw loi("Vui lòng chọn Từ ngày hợp lệ.");
  if (!ngayTuIso(kt) || !/^\d{4}-\d{2}-\d{2}$/.test(kt)) throw loi("Vui lòng chọn Đến ngày hợp lệ.");
  if (kt < bd) throw loi("Ngày kết thúc phải sau ngày bắt đầu.");
  await Promise.all([
    upsert("cau_hinh", { khoa: "NAM_HOC_BAT_DAU", gia_tri: bd }, "khoa"),
    upsert("cau_hinh", { khoa: "NAM_HOC_KET_THUC", gia_tri: kt }, "khoa"),
  ]);
  return { success: true, namHocBatDau: bd, namHocKetThuc: kt };
}

async function admGiaoLyLuuBai(args) {
  const nguoi = await xacThuc(args[0], "admin");
  const b = args[1] || {};
  const tenBai = String(b.tenBai || "").trim();
  if (!tenBai) throw loi("Vui lòng nhập tên bài dạy.");
  const cat = (v, n) => String(v == null ? "" : v).trim().substring(0, n);
  const luc = new Date().toISOString();
  const cacBai = await chonTatCa("bai_day");
  let maBai = String(b.maBai || "").trim().toUpperCase();
  const cu = (cacBai || []).filter((r) => String(r.ma_bai).toUpperCase() === maBai)[0];
  if (maBai) {
    if (!cu) throw loi("Không tìm thấy bài dạy này.");
  } else {
    let max = 0;
    (cacBai || []).forEach((r) => {
      const m = /^BD(\d+)$/.exec(String(r.ma_bai || "").trim().toUpperCase());
      if (m) max = Math.max(max, Number(m[1]));
    });
    maBai = "BD" + ("000" + (max + 1)).slice(-4);
  }
  await upsert("bai_day", {
    ma_bai: maBai,
    ma_lop: cat(b.maLop, 40).toUpperCase(),
    ten_bai: cat(tenBai, 200),
    chu_de: cat(b.chuDe, 200),
    muc_tieu: String(b.mucTieu || "").substring(0, 2000),
    noi_dung: String(b.noiDung || "").substring(0, 20000),
    tai_lieu: String(b.taiLieu || "").substring(0, 2000),
    thu_tu: Number(b.thuTu) || 0,
    ma_glv: cat(b.maGLV, 40) || nguoi.ma,
    ngay_tao: cu ? String(cu.ngay_tao || luc) : luc,
    ngay_cap_nhat: luc,
  }, "ma_bai");
  return { success: true, maBai };
}

async function admGiaoLyXoaBai(args) {
  await xacThuc(args[0], "admin");
  const ma = String(args[1] || "").trim().toUpperCase();
  if (!ma) throw loi("Thiếu mã bài dạy.");
  await Promise.all([
    db("bai_day", { method: "DELETE", query: "ma_bai=eq." + encodeURIComponent(ma) }),
    db("lich_giao_ly_tuan", { method: "DELETE", query: "ma_bai=eq." + encodeURIComponent(ma) }),
  ]);
  return { success: true };
}

async function admGiaoLyDatLich(args) {
  await xacThuc(args[0], "admin");
  const maLop = String(args[1] || "").trim().toUpperCase();
  const maBai = String(args[2] || "").trim().toUpperCase();
  const ngay = String(args[3] || "").trim().slice(0, 10);
  const dl = await duLieuGl();
  const coBai = dl.dsBai.some((b) => b.maBai === maBai);
  if (!coBai) throw loi("Không tìm thấy bài dạy này.");
  if (dl.dsTuanNgay.indexOf(ngay) < 0) throw loi("Ngày này không phải Chúa Nhật trong niên khoá.");
  await upsert("lich_giao_ly_tuan", {
    ma_lop: maLop, ma_bai: maBai, ngay, ngay_goc: ngay,
    trang_thai: "hoc", ghi_chu: "", nguoi: "", luc: new Date().toISOString(),
  }, "ma_lop,ma_bai");
  return { success: true };
}

async function admGiaoLyBoLich(args) {
  await xacThuc(args[0], "admin");
  const maLop = String(args[1] || "").trim().toUpperCase();
  const maBai = String(args[2] || "").trim().toUpperCase();
  await db("lich_giao_ly_tuan", {
    method: "DELETE",
    query: "ma_lop=eq." + encodeURIComponent(maLop) + "&ma_bai=eq." + encodeURIComponent(maBai),
  });
  return { success: true };
}

async function admGiaoLyCapNhatTuan(args) {
  const nguoi = await xacThuc(args[0], "admin");
  const maLop = String(args[1] || "").trim().toUpperCase();
  const ngay = String(args[2] || "").trim().slice(0, 10);
  const tt = String(args[3] || "hoc").trim();
  const ghiChu = String(args[4] || "");
  if (TRANG_THAI_TUAN.indexOf(tt) < 0) throw loi("Trạng thái tuần không hợp lệ.");
  const dl = await duLieuGl();
  if (dl.dsTuanNgay.indexOf(ngay) < 0) throw loi("Ngày này không nằm trong niên khoá.");
  if (tt === "hoc") {
    await db("tuan_nghi", {
      method: "DELETE",
      query: "ma_lop=eq." + encodeURIComponent(maLop) + "&ngay=eq." + encodeURIComponent(ngay),
    });
  } else {
    await upsert("tuan_nghi", {
      ma_lop: maLop, ngay, trang_thai: tt, ghi_chu: ghiChu,
      nguoi: nguoi.ma, luc: new Date().toISOString(),
    }, "ma_lop,ngay");
  }
  return { success: true };
}

const HAM = {
  xdSqlPing: async () => ({ ok: true, dangChay: "sql", thoiGian: Date.now() }),
  admGiaoLyLayDuLieu,
  glvLayTienDo,
  admGiaoLyLuuNamHoc,
  admGiaoLyLuuBai,
  admGiaoLyXoaBai,
  admGiaoLyDatLich,
  admGiaoLyBoLich,
  admGiaoLyCapNhatTuan,
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Chỉ nhận POST", code: "SAI_PHUONG_THUC" });
    return;
  }

  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); }
  catch (e) { res.status(400).json({ ok: false, error: "JSON không hợp lệ" }); return; }

  const fn = String(body.fn || "").trim();
  const args = Array.isArray(body.args) ? body.args : [];
  if (!Object.prototype.hasOwnProperty.call(SQL_FN, fn)) {
    res.status(200).json({ ok: false, error: "Hàm này chưa có bản SQL: " + fn, code: "CHUA_SQL" });
    return;
  }

  try {
    const result = await HAM[fn](args);
    res.status(200).json({ ok: true, result });
  } catch (e) {
    const msg = String((e && e.message) || e);
    const code = (e && e.code) || "LOI_SQL";
    console.error("[api/sql] " + fn + ": " + msg);
    res.status(code === "CHUA_CAU_HINH" ? 500 : 200).json({ ok: false, error: msg, code });
  }
};
