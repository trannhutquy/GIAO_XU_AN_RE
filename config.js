// DÁN URL "Web app" của Apps Script vào đây (kết thúc bằng /exec)
window.GAS_URL = "https://script.google.com/macros/s/AKfycbxgKaYg-5fBvx1r4_pU4316aCe-tBWVGNL4VBVQgyotsahs3AQ6Ou6ck9k4IhQV2k2G/exec";

// ============================================================================
//  CÔNG TẮC BACKEND SQL (chế độ hybrid)
// ----------------------------------------------------------------------------
//  "off"    -> mặc định, mọi thứ vẫn đi qua Apps Script như hiện tại.
//  "sql"    -> các hàm Giáo Lý đi qua /api/sql (Supabase). Hàm chưa có bản SQL
//              tự động rơi lại Apps Script, nên app không bao giờ bị kẹt.
//  "shadow" -> gọi SQL trước; nếu lỗi thì gọi Apps Script (dùng lúc thử nghiệm).
//
//  Muốn bật: đổi thành "sql" -> deploy web -> thử tab Bài Dạy & Lịch Trình.
//  Muốn lui lại ngay: đổi về "off" -> deploy lại (không cần đụng CSDL).
// ============================================================================
window.SQL_CHE_DO = "sql";
