# Chuyển sang SQL (chế độ hybrid)

Dữ liệu **app ghi** chuyển sang Postgres/Supabase. **CSDL gốc vẫn đọc qua Apps
Script** như cũ. Tên hàm giữ nguyên nên `index.html` không sửa gì.

## Luồng hiện tại

```
index.html → gas-shim.js → /api/sql (Supabase)   ← khi bật SQL
                         ↘ GAS /exec             ← hàm chưa có bản SQL / khi tắt
```

Mặc định `window.SQL_CHE_DO = "off"` trong `config.js` → app vẫn chạy 100% như cũ.

## Các bước làm một lần

### 1. Supabase

1. Đăng ký → New project (chọn region gần nhất, free 500 MB).
2. Project → **SQL Editor** → paste toàn bộ `sql/schema.sql` → **Run**.
   Chạy lại nhiều lần được, không mất dữ liệu.
3. Project Settings → API → copy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` **secret** → `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ Không dùng `anon key`, và không bao giờ đưa key này vào file trong repo.

### 2. Apps Script (chỉ dán file nhỏ)

Mở project Apps Script → file `API.gs` → **xoán toàn bộ nội dung cũ → dán
`Google_Sheet/API.txt` mới** (đã thêm hàm `xdXacThucSQL` + whitelist).
`Code.gs` **không cần dán lại**.

Sau đó: Deploy → Manage deployments → ✏️ → **New version** → Deploy.
Giữ nguyên URL `/exec`.

> Hàm `xdXacThucSQL` chỉ trả mã/tên/quyền để `/api/sql` tin token do Apps Script
> cấp. Nếu quên dán API.txt, khi bật SQL sẽ báo “Không xác thực được phiên…”

### 3. Vercel

Project settings → Environment Variables → thêm:

| Tên | Giá trị |
|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role secret |
| `GAS_URL` | *(tuỳ chọn)* URL `/exec`, đã có default trong `api/sql.js` |

Rồi **Redeploy**. Không cần `package.json`, không cài npm (`api/sql.js` dùng `fetch` có sẵn).

### 4. Import dữ liệu Giáo Lý hiện có

Trên trình duyệt đang đăng nhập Admin, mở Console (`F12`):

```js
JSON.parse(localStorage.getItem('xd_phien_v1')).token
```

Copy token đó rồi chạy trong PowerShell tại thư mục `PWA_web\web`:

```powershell
$env:ADMIN_TOKEN = "dán-token-vào-đây"
node sql/seed-giao-ly.js
```

Script tạo `sql/giao_ly_seed.sql` (gồm cả danh sách lớp lấy từ CSDL gốc).
Mở file đó trong Supabase SQL Editor → Run.
⚠️ File seed chứa dữ liệu nội bộ → không commit lên GitHub.

> Khi CSDL gốc thêm/sửa lớp, chạy lại seed rồi Run file SQL để cập nhật bảng
> `lop_giao_ly` (snapshot chỉ đọc). Nếu quên, dropdown lớp trên tab Bài Dạy sẽ
> thiếu lớp mới.

Các mảng khác (điểm danh, CTTT, quỹ…) chưa chuyển ở đợt này — vẫn đi qua Apps
Script. Bảng của chúng đã có trong `schema.sql` sẵn cho các đợt sau.

### 5. Bật thử

Sửa `config.js`:

```js
window.SQL_CHE_DO = "sql";
```

Deploy web lại, mở tab **Bài Dạy & Lịch Trình**, thử: đổi niên khoá, thêm bài,
gán lịch, đánh dấu tuần nghỉ, rồi mở app GLV xem tiến độ.

Nếu có lỗi: đổi lại `"off"` và deploy → lập tức về Apps Script, không mất dữ liệu.

Muốn thử không ghi: dùng `"shadow"` → chỉ các hàm **đọc** đi qua SQL, hàm ghi vẫn
giữ ở Apps Script.

## Hàm đã có bản SQL

| Hàm | Trạng thái |
|---|---|
| `admGiaoLyLayDuLieu`, `glvLayTienDo` | ✅ đọc |
| `admGiaoLyLuuBai`, `admGiaoLyXoaBai` | ✅ ghi |
| `admGiaoLyDatLich`, `admGiaoLyBoLich`, `admGiaoLyCapNhatTuan` | ✅ ghi |
| `admGiaoLyLuuNamHoc` | ✅ ghi (lưu cả 2 ngày từ/đến) |
| Mọi hàm khác | tự động rơi lại Apps Script (`CHUA_SQL`) |

## Lưu ý vận hành

- Token lạ được `/api/sql` hỏi Apps Script **1 lần**, sau đó lưu vào bảng
  `phien_dang_nhap`. Nếu muốn bắt hỏi lại: `delete from phien_dang_nhap;`
- Supabase free tự ngủ sau 7 ngày không dùng → request đầu có thể chậm vài giây.
- Service_role key bypass RLS, nên **chỉ Vercel env** mới có. Browser chỉ gọi
  cùng origin `/api/sql`.
- Không ghi trực tiếp vào `doan_sinh` (snapshot CSDL gốc).
