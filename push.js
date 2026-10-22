/*
 * push.js — bật/tắt thông báo đẩy cho thiết bị này (Firebase Cloud Messaging).
 * Thư viện Firebase chỉ được nạp khi người dùng bật thông báo, nên không làm chậm lúc mở app.
 */
(function () {
  "use strict";
  var KEY_BAT = "xd_push_bat";      // "1" khi thiết bị này đã bật thông báo
  var KEY_TOKEN = "xd_push_token";  // mã thiết bị FCM (gửi kèm khi đăng xuất để gỡ đúng máy)
  var msg = null, sdk = null;

  function cfg() { return window.FIREBASE_CONFIG || null; }
  function cauHinhOk() {
    var c = cfg(), v = window.FCM_VAPID_KEY;
    if (!c || !v) return false;
    if (!c.apiKey || !c.projectId || !c.messagingSenderId || !c.appId) return false;
    return !/DAN_VAO/i.test(JSON.stringify(c) + v);
  }
  function hoTro() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
  function laIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
  function laStandalone() { return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; }
  function daBat() { try { return localStorage.getItem(KEY_BAT) === "1"; } catch (e) { return false; } }
  function tokenLuu() { try { return localStorage.getItem(KEY_TOKEN) || ""; } catch (e) { return ""; } }
  function luu(bat, token) {
    try {
      if (bat) { localStorage.setItem(KEY_BAT, "1"); if (token) localStorage.setItem(KEY_TOKEN, token); }
      else { localStorage.removeItem(KEY_BAT); localStorage.removeItem(KEY_TOKEN); }
    } catch (e) {}
  }
  function phien() { return (typeof currentUserToken !== "undefined" && currentUserToken) ? currentUserToken : ""; }
  function thongBao(m, loai) { try { if (typeof showToast === "function") showToast(m, loai || "info"); } catch (e) {} }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = res;
      s.onerror = function () { rej(new Error("Không tải được " + src)); };
      document.head.appendChild(s);
    });
  }
  function goiServer(fn, args) {
    return new Promise(function (res, rej) {
      var r = google.script.run.withSuccessHandler(res).withFailureHandler(rej);
      r[fn].apply(r, args);
    });
  }

  // Tin đến khi app đang mở và đang được nhìn: hiện thông báo trong app + cập nhật chấm đỏ ngay
  function khiNhanTinDangMo(p) {
    var d = (p && p.data) || {};
    try {
      var dangXemDungHoiThoai = typeof chatState !== "undefined" && chatState && d.tag &&
        d.tag === "chat-" + String(chatState.maDoiTac || "").toUpperCase();
      if (!dangXemDungHoiThoai) thongBao((d.title ? d.title + ": " : "") + (d.body || ""), "info");
    } catch (e) {}
    try { if (typeof pollNen === "function") pollNen(); } catch (e2) {}
  }

  function napSdk() {
    if (sdk) return sdk;
    sdk = loadScript("firebase-app-compat.js")
      .then(function () { return loadScript("firebase-messaging-compat.js"); })
      .then(function () {
        if (!firebase.apps.length) firebase.initializeApp(cfg());
        msg = firebase.messaging();
        msg.onMessage(khiNhanTinDangMo);
        return msg;
      })
      .catch(function (e) { sdk = null; throw e; });
    return sdk;
  }
  function layTokenFcm() {
    return navigator.serviceWorker.ready.then(function (reg) {
      return napSdk().then(function (m) { return m.getToken({ vapidKey: window.FCM_VAPID_KEY, serviceWorkerRegistration: reg }); });
    });
  }

  function bat() {
    if (laIOS() && !laStandalone()) return Promise.resolve({ ok: false, ly: "ios-chua-cai" });
    if (!hoTro()) return Promise.resolve({ ok: false, ly: "khong-ho-tro" });
    if (!cauHinhOk()) return Promise.resolve({ ok: false, ly: "chua-cau-hinh" });
    if (!phien()) return Promise.resolve({ ok: false, ly: "chua-dang-nhap" });
    // requestPermission phải được gọi ngay trong lúc người dùng bấm nút
    return Notification.requestPermission().then(function (p) {
      if (p !== "granted") return { ok: false, ly: p === "denied" ? "bi-chan" : "chua-cap-quyen" };
      return layTokenFcm().then(function (t) {
        if (!t) return { ok: false, ly: "khong-lay-duoc-ma" };
        return goiServer("dangKyThongBao", [phien(), t]).then(function (r) {
          if (!r || !r.success) return { ok: false, ly: "may-chu", chiTiet: r && r.error };
          luu(true, t);
          return { ok: true, thu: r.thu, moi: r.moi };
        });
      });
    }).catch(function (e) { return { ok: false, ly: "loi", chiTiet: String((e && e.message) || e) }; });
  }

  function tat() {
    var t = tokenLuu(), p = phien();
    var gỡServer = (t && p) ? goiServer("huyDangKyThongBao", [p, t]).catch(function () {}) : Promise.resolve();
    return gỡServer.then(function () {
      if (!cauHinhOk() || !hoTro()) return;
      return napSdk().then(function (m) { return m.deleteToken(); }).catch(function () {});
    }).then(function () { luu(false); return { ok: true }; });
  }

  // Gọi sau mỗi lần đăng nhập: gắn lại thiết bị với tài khoản đang dùng (cũng làm mới mã thiết bị nếu đổi)
  function dongBo() {
    if (!daBat() || !hoTro() || !cauHinhOk() || !phien()) { capNhatNhan(); return; }
    if (Notification.permission !== "granted") { luu(false); capNhatNhan(); return; }
    layTokenFcm().then(function (t) {
      if (!t) return;
      return goiServer("dangKyThongBao", [phien(), t]).then(function (r) { if (r && r.success) luu(true, t); });
    }).catch(function () {}).then(capNhatNhan);
  }

  var LOI = {
    "ios-chua-cai": "Trên iPhone, hãy bấm nút Chia sẻ → Thêm vào Màn hình chính, rồi mở app từ biểu tượng đó để bật thông báo.",
    "khong-ho-tro": "Trình duyệt này chưa hỗ trợ thông báo đẩy. Hãy dùng Chrome hoặc cài app lên màn hình chính.",
    "chua-cau-hinh": "Thông báo đẩy chưa được cấu hình. Vui lòng báo Quản trị viên.",
    "bi-chan": "Bạn đã chặn thông báo. Hãy bật lại quyền Thông báo cho app trong Cài đặt của điện thoại hoặc trình duyệt.",
    "chua-cap-quyen": "Bạn chưa cho phép thông báo nên chưa bật được.",
    "chua-dang-nhap": "Hãy đăng nhập trước khi bật thông báo.",
    "khong-lay-duoc-ma": "Không lấy được mã thiết bị. Hãy thử lại sau ít phút."
  };

  function capNhatNhan() {
    var on = daBat() && "Notification" in window && Notification.permission === "granted";
    var lb = document.getElementById("menu-push-label"), ic = document.getElementById("menu-push-icon");
    if (lb) lb.textContent = on ? "Tắt thông báo" : "Bật thông báo";
    if (ic) ic.className = "fas " + (on ? "fa-bell-slash" : "fa-bell");
  }

  var dangXuLy = false;
  function bamNut() {
    if (dangXuLy) return;
    dangXuLy = true;
    function xong() { dangXuLy = false; capNhatNhan(); }
    if (daBat()) {
      tat().then(function () { thongBao("Đã tắt thông báo trên thiết bị này.", "info"); xong(); }, xong);
      return;
    }
    thongBao("Đang bật thông báo...", "info");
    bat().then(function (r) {
      if (r.ok) {
        if (r.moi && r.thu && r.thu !== "ok") thongBao("Đã đăng ký thiết bị nhưng máy chủ chưa gửi được thông báo thử. Hãy báo Quản trị viên kiểm tra cấu hình.", "error");
        else thongBao("Đã bật thông báo! Bạn sẽ nhận một thông báo thử trong giây lát.", "success");
      } else {
        thongBao(LOI[r.ly] || ("Không bật được thông báo" + (r.chiTiet ? ": " + r.chiTiet : ".")), "error");
      }
      xong();
    });
  }

  // ----- Mở đúng màn hình khi bấm vào thông báo (mo = "chat" | "don") -----
  var choMo = "";
  function thuMo() {
    if (!choMo) return;
    var main = document.getElementById("main-app");
    var san = main && getComputedStyle(main).display !== "none" && !document.getElementById("session-restore") && phien();
    if (!san) return;
    var mo = choMo; choMo = "";
    try {
      if (mo === "chat" && typeof openChatList === "function") openChatList();
      else if (mo === "tb" && window.XDThongBao) window.XDThongBao.moLichSu();
      else if (mo === "don" && typeof showPage === "function" && typeof currentUserIsAdmin !== "undefined" && currentUserIsAdmin) showPage("approval-page", null);
    } catch (e) {}
  }
  function datMo(mo) {
    choMo = mo || "";
    if (!choMo) return;
    var t0 = Date.now();
    (function lap() { thuMo(); if (choMo && Date.now() - t0 < 25000) setTimeout(lap, 400); })();
  }
  try {
    var u = new URL(location.href), mo = u.searchParams.get("mo");
    if (mo) { u.searchParams.delete("mo"); history.replaceState(null, "", u.pathname + (u.search || "") + u.hash); datMo(mo); }
  } catch (e) {}
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (e.data && e.data.type === "mo-man-hinh") datMo(e.data.mo);
    });
  }
  document.addEventListener("DOMContentLoaded", capNhatNhan);

  window.XDPush = {
    bamNut: bamNut, dongBo: dongBo, capNhatNhan: capNhatNhan,
    // Đăng xuất: máy này thôi nhận thông báo của tài khoản cũ (server đã gỡ thiết bị); người sau phải tự bật lại
    khiDangXuat: function () { luu(false); capNhatNhan(); },
    tokenThietBi: tokenLuu, daBat: daBat, cauHinhOk: cauHinhOk
  };
})();
