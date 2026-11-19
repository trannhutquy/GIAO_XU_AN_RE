-- ============================================================================
--  schema.sql — CSDL Postgres (Supabase) cho app Xứ Đoàn
-- ----------------------------------------------------------------------------
--  Dùng chế độ HYBRID:
--    * Dữ liệu app ghi (bài, lịch, điểm danh, CTTT, quỹ...) -> SQL.
--    * CSDL gốc (danh sách Thiếu Nhi / lớp) vẫn đọc qua Apps Script như cũ.
--  Tên hàm giữ nguyên nên index.html KHÔNG cần sửa.
--
--  CÁCH DÙNG: Supabase Dashboard -> SQL Editor -> paste toàn bộ file -> Run.
--  Chạy lại nhiều lần không làm mất dữ liệu (IF NOT EXISTS).
-- ============================================================================

-- ---------- 1. NGƯỜI DÙNG & PHIÊN (dùng chung HT/GLV như hiện tại) ----------
create table if not exists nguoi_dung (
  ma            text primary key,
  loai          text not null check (loai in ('HT','GLV')),
  ten           text not null default '',
  chi_doan      text default '',
  ma_lop        text default '',
  mat_khau_hash text default '',
  anh_url       text default '',
  active        boolean not null default true,
  is_admin      boolean not null default false,
  cap_nhat_luc  timestamptz default now()
);

-- Token do Apps Script cấp (UUID), SQL chỉ lưu bản copy để tự xác thực nhanh.
-- Lần đầu gặp token lạ, /api/sql gọi hàm xdXacThucSQL trên Apps Script 1 lần.
create table if not exists phien_dang_nhap (
  token        text primary key,
  loai         text not null check (loai in ('HT','GLV')),
  ma           text not null,
  ten          text default '',
  is_admin     boolean not null default false,
  het_han_ms   bigint not null,
  cap_nhat_luc timestamptz default now()
);
create index if not exists idx_phien_ma on phien_dang_nhap(ma);

-- ---------- 2. CẤU HÌNH ----------
-- Thay cho CAU_HINH_APP, GIAO_LY_CAU_HINH, CAU_HINH_QUY (dạng key/value).
create table if not exists cau_hinh (
  khoa     text primary key,
  gia_tri  text
);

-- ---------- 3. LỚP GIÁO LÝ ----------
-- ma_lop CHỮ HOA (BAO ĐỒNG 1, THÊM SỨC 3A...). Lấy từ CSDL gốc;
-- app chỉ lưu thông tin phụ (khối, phòng, lịch...).
create table if not exists lop_giao_ly (
  ma_lop         text primary key,
  ten_lop        text not null,
  khoi           text default '',
  nien_khoa      text default '',
  phong_hoc      text default '',
  lich_hoc       text default '',
  si_so_du_kien  integer default 0,
  ghi_chu        text default '',
  nguon          text default 'CSDL',
  cap_nhat_luc   timestamptz default now()
);

-- ---------- 4. GIÁO LÝ: KHO BÀI + LỊCH + TUẦN NGHỈ ----------
-- ma_lop = '' hoặc 'ALL' => bài dùng chung mọi lớp.
create table if not exists bai_day (
  ma_bai        text primary key,
  ma_lop        text not null default '',
  ten_bai       text not null,
  chu_de        text default '',
  muc_tieu      text default '',
  noi_dung      text default '',
  tai_lieu      text default '',
  thu_tu        integer not null default 0,
  ma_glv        text default '',
  ngay_tao      text default '',
  ngay_cap_nhat text default '',
  cap_nhat_luc  timestamptz default now()
);
create index if not exists idx_bai_lop on bai_day(ma_lop, thu_tu);

-- Mỗi bài chỉ gán 1 lần cho 1 lớp; ngày_goc giữ lại để tính dồn bài.
create table if not exists lich_giao_ly_tuan (
  ma_lop      text not null default '',
  ma_bai      text not null,
  ngay        date not null,
  trang_thai  text not null default 'hoc',
  ghi_chu     text default '',
  nguoi       text default '',
  luc         text default '',
  ngay_goc    date,
  cap_nhat_luc timestamptz default now(),
  primary key (ma_lop, ma_bai)
);
create index if not exists idx_lich_ngay on lich_giao_ly_tuan(ngay);

-- Thay cho các key "TUAN_NGHI|<MÃ LỚP>|<NGÀY>" lưu JSON trong GIAO_LY_CAU_HINH.
-- ma_lop = '' => nghỉ dùng chung; có mã lớp => override dùng chung.
create table if not exists tuan_nghi (
  ma_lop      text not null default '',
  ngay        date not null,
  trang_thai  text not null check (trang_thai in ('hoc','nghi_dạy','nghi_hoc','glv_xin_nghi')),
  ghi_chu     text default '',
  nguoi       text default '',
  luc         text default '',
  cap_nhat_luc timestamptz default now(),
  primary key (ma_lop, ngay)
);

-- ---------- 5. CSDL GỐC (snapshot, CHỈ ĐỌC từ Google Sheet) ----------
-- Không được ghi trực tiếp vào bảng này từ app. Dùng script đồng bộ 1 chiều.
create table if not exists doan_sinh (
  ma_tn         text primary key,
  ho_ten        text default '',
  ma_lop        text default '',
  ngay_sinh     text default '',
  ten_phuhuynh  text default '',
  sdt_phuhuynh  text default '',
  ghi_chu       text default '',
  cap_nhat_luc  timestamptz default now()
);
create index if not exists idx_tn_lop on doan_sinh(ma_lop);

-- ---------- 6. ĐIỂM DANH & GHI CHÚ GLV ----------
create table if not exists diem_danh_giao_ly (
  id              bigserial primary key,
  ma_lop          text default '',
  ma_tn           text not null,
  ngay            date not null,
  gio             text default '',
  thoi_gian_ms    bigint default 0,
  nguoi_diem_danh text default '',
  trang_thai      text default '',
  ly_do           text default '',
  cap_nhat_luc    timestamptz default now(),
  unique (ma_lop, ma_tn, ngay, gio)
);
create index if not exists idx_dd_ngay on diem_danh_giao_ly(ngay, ma_lop);

create table if not exists glv_ghi_chu_tn (
  ma_tn        text not null,
  ma_lop       text not null default '',
  ghi_chu      text default '',
  ma_glv       text default '',
  cap_nhat_luc timestamptz default now(),
  primary key (ma_tn, ma_lop)
);

-- ---------- 7. CTTT ----------
create table if not exists cttt_cho_duyet (
  id            text primary key,
  linh_vuc      text default '',
  ten_bai       text default '',
  noi_dung      text default '',
  chi_doan      text default '',
  ngay_day      text default '',
  ma_ht_gui     text default '',
  ten_ht_gui    text default '',
  trang_thai    text default '',
  thoi_gian_gui text default '',
  ma_nguoi_duyet text default '',
  ten_nguoi_duyet text default '',
  thoi_gian_duyet text default '',
  ghi_chu       text default '',
  cap_nhat_luc  timestamptz default now()
);

create table if not exists cttt_backup (
  id            bigserial primary key,
  ky_luu_tru    text default '',
  ma_ht         text default '',
  ten_ht        text default '',
  linh_vuc      text default '',
  ten_bai       text default '',
  noi_dung      text default '',
  chi_doan      text default '',
  ngay_day      text default '',
  trang_thai    text default '',
  thoi_gian_gui text default '',
  nguoi_duyet   text default '',
  thoi_gian_duyet text default '',
  ghi_chu       text default ''
);

-- ---------- 8. QUỸ ----------
-- Tồn quỹ = SO_DU_DAU_KY + sum(thu) - sum(chi), tính trong /api/sql sau này.
create table if not exists thu_quy (
  id            bigserial primary key,
  ma_doi_tuong  text not null,
  loai          text default '',
  ngay          date not null,
  tuan          text default '',
  so_tien       numeric(14,0) default 0,
  nguoi_thu     text default '',
  cap_nhat_luc  timestamptz default now(),
  unique (ma_doi_tuong, ngay, nguoi_thu)
);

create table if not exists chi_quy (
  id            bigserial primary key,
  ngay          date not null,
  noi_dung      text default '',
  so_tien       numeric(14,0) default 0,
  nguoi_chi     text default '',
  ghi_chu       text default '',
  hoa_don_url   text default '',
  nguoi_ghi_nhan text default '',
  thoi_gian_ghi text default ''
);

-- Dòng miễn thu: lưu riêng thay vì chuỗi "MIENTHU_HT" trong CAU_HINH_QUY.
create table if not exists mien_thu_quy (
  loai     text not null,
  ma       text not null,
  primary key (loai, ma)
);

-- ============================================================================
--  GHI CHÚ BẢO MẬT
--  - Chỉ /api/sql (Vercel) mới dùng SUPABASE_SERVICE_ROLE_KEY.
--  - Browser KHÔNG BAO GIỜ thấy key này, chỉ gọi /api/sql cùng origin.
--  - Nếu sau này bật RLS, nhớ tạo policy cho service_role (đã có sẵn quyền
--    bypass RLS) và KHÔNG mở anon key ra public cho các bảng ghi.
-- ============================================================================
