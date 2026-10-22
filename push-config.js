// ============================================================================
//  CẤU HÌNH THÔNG BÁO ĐẨY  —  điền 1 lần, sau đó KHÔNG cần sửa nữa.
//  Những giá trị này không phải mật khẩu (trình duyệt nào cũng thấy được).
//  Chỉ còn thiếu 1 dòng: __vapid (khoá Web Push) — xem hướng dẫn bước 2.
// ============================================================================
var __cfg = {
  apiKey: "AIzaSyA5gCOnFoJZOlyWLdUdywUDgn2BDGYkhso",
  authDomain: "bensieu-1212.firebaseapp.com",
  projectId: "bensieu-1212",
  storageBucket: "bensieu-1212.firebasestorage.app",
  messagingSenderId: "427017916022",
  appId: "1:427017916022:web:3f4024c17eaa66af029957"
};
var __vapid = "BO6781Sg6wug9niKpUJku9qlfE5UL9xH81mEh1ii-UHavnIwLDWn5YKOCgVbfMUgmVnu91Whn7_eFatanDwIbkk";

// (dùng được cả trong trang web lẫn trong service worker)
(typeof self !== "undefined" ? self : window).FIREBASE_CONFIG = __cfg;
(typeof self !== "undefined" ? self : window).FCM_VAPID_KEY = __vapid;