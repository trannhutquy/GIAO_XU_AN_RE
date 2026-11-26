/*
 * gas-shim.js — giả lập google.script.run bằng fetch tới Apps Script Web App,
 * kèm các tối ưu tốc độ:
 *   1. Cache "hiện ngay – cập nhật sau" cho các màn hình danh sách ít đổi
 *   2. Gộp các lời gọi đọc giống hệt nhau đang chạy cùng lúc
 *   3. Tự thử lại 1 lần khi lỗi mạng/lỗi tạm thời (chỉ với hàm ĐỌC, không bao giờ với hàm GHI)
 *   4. Các vòng lặp nền (setInterval >= 2 giây) tự tạm dừng khi app chạy ngầm, chạy bù khi quay lại
 *   5. Vài hàm đọc không tham số đi qua lớp đệm /api/gas (Vercel) để đỡ tốn lượt chạy Apps Script
 */
(function () {
  "use strict";
  var TIMEOUT_MS = 90000;

  // ---------- phân loại hàm ----------
  // Whitelist tường minh thay cho regex prefix. Regex cũ làm 13 hàm ĐỌC bị coi
  // là GHI (điển hình khanCapAdminLayMaHienTai bị poll mỗi 2 giây) -> cứ sau
  // mỗi lần poll lại gọi gasCacheClear() và xoá sạch cache. Chỉ liệt kê hàm
  // chắc chắn không đổi dữ liệu; hàm nào chưa chắc cứ coi là GHI cho an toàn.
  var READ_FN = {
    getAppConfigData: 1, getBaoCaoVangLeThieuNhi: 1, getCTTTData: 1, getChiTietThieuNhi: 1,
    getDanhSachThieuNhi: 1, getHTAttendanceCalendar: 1, getHanhTrinhData: 1, getLeaveRequests: 1,
    getLichSuChinhSuaTN: 1, getMyLeaveRequests: 1, getThongTinLopCuaGLV: 1, getToanBoDanhSach: 1,
    getWorkAssignments: 1,
    pollTongHop: 1, countPendingLeaveRequests: 1,
    xdBootstrap: 1, xdChung: 1, xdCuaToi: 1,
    admChucVuDanhSach: 1, admGiaoLyLayDuLieu: 1,
    admKiemTraChiTietBaiLam: 1, admKiemTraChiTietDe: 1, admKiemTraDanhSachBaiLam: 1,
    admKiemTraDanhSachDe: 1, admKiemTraDanhSachKho: 1, admKiemTraLayDanhSachGanMa: 1,
    admKiemTraThongKe: 1,
    admLayDanhSachDB: 1, admLayDanhSachGLV: 1, admLayDanhSachLopGiaoLy: 1,
    admLayDanhSachSheet: 1, admLayDanhSachTNGiaoLy: 1, admLayDanhSachThongBaoChung: 1,
    admLayDanhSachYeuCauQuenMKGLV: 1, admLayDuLieuSheet: 1, admLayQuyTongQuan: 1,
    admLayThongKeOnDinh: 1,
    admThiDuaDanhSachDeXuat: 1, admThiDuaLichSu: 1, admThiDuaLichSuDeXuat: 1,
    adminLayDanhSachYeuCauQuenMK: 1,
    ctttLayBackupCuaToi: 1, ctttLayChoDuyet: 1,
    glvLayHoSoTN: 1, glvLayLichSuDiemDanh: 1, glvLayTienDo: 1,
    htLayDanhSachYeuCauThayDoi: 1,
    khanCapAdminLayMaHienTai: 1,
    kiemTraDanhSachChoHT: 1, kiemTraLayDeDeLam: 1, kiemTraLichSuCuaToi: 1,
    layDanhSachThieuNhiLopGLV: 1, layDiemDanhHomNayGLV: 1, layThongBaoChung: 1,
    layThongTinCaNhanCSDLHT: 1, layTrangThaiBaoTri: 1,
    quyLayDanhSachChiThang: 1, quyLayDanhSachHTMienThu: 1, quyLayDanhSachTuan: 1,
    quyLayMucDong: 1, quyLayTonQuyHienTai: 1, quyTrangThaiCaNhanHT: 1,
    soBoHTLayDanhSach: 1, vanBanLayDanhSach: 1,
    thiDuaLayBangXepHang: 1, thiDuaLayDanhSachHanhVi: 1, thiDuaLayDiemCuaToi: 1,
    thiDuaLayDsHTChoAdmin: 1, thongBaoLayNhacViec: 1
  };
  // Màn hình hiện ngay dữ liệu cũ rồi cập nhật dữ liệu mới (tối đa 24 giờ tuổi)
  var SWR = { getHanhTrinhData: 1, getCTTTData: 1, vanBanLayDanhSach: 1, soBoHTLayDanhSach: 1,
              thiDuaLayBangXepHang: 1, getDanhSachThieuNhi: 1, getToanBoDanhSach: 1 };
  var SWR_MAX_AGE = 24 * 3600 * 1000;
  // Dùng lại dữ liệu trong thời gian ngắn, không gọi server. Mọi lượt GHI
  // vẫn xoá cache nên thao tác sửa luôn thấy dữ liệu mới ngay.
  var TTL = {
    getAppConfigData: 5 * 60 * 1000,
    pollTongHop: 20 * 1000,
    thongBaoLayNhacViec: 60 * 1000,
    layThongBaoChung: 60 * 1000,
    countPendingLeaveRequests: 20 * 1000,
    quyLayDanhSachTuan: 30 * 1000,
    quyTrangThaiCaNhanHT: 30 * 1000
  };
  var CACHE_PREFIX = "xdc:";
  var MAX_ENTRY_CHARS = 400000;

  function isRead(fn) { return !!READ_FN[fn]; }

  // ---------- cache ----------
  var mem = {};
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function cacheGet(key) {
    var k = CACHE_PREFIX + hash(key);
    var e = mem[k];
    if (!e) {
      try { var raw = localStorage.getItem(k); if (raw) { e = JSON.parse(raw); mem[k] = e; } } catch (x) {}
    }
    return e && e.key === key ? e : null;
  }
  function cacheSet(key, v) {
    if (v && typeof v === "object" && v.success === false) return; // không cache kết quả lỗi
    var k = CACHE_PREFIX + hash(key);
    var e = { key: key, t: Date.now(), v: v };
    mem[k] = e;
    try {
      var s = JSON.stringify(e);
      if (s.length <= MAX_ENTRY_CHARS) localStorage.setItem(k, s);
    } catch (x) { clearStored(); }
  }
  function clearStored() {
    try {
      var del = [];
      for (var i = 0; i < localStorage.length; i++) { var n = localStorage.key(i); if (n && n.indexOf(CACHE_PREFIX) === 0) del.push(n); }
      del.forEach(function (n) { localStorage.removeItem(n); });
    } catch (x) {}
  }
  window.gasCacheClear = function () { mem = {}; clearStored(); };

  // ---------- P4: invalidate theo version ----------
  // Khác với key cache xdc:*, key này KHÔNG bị gasCacheClear() xoá, nên có thể
  // so sánh bản cũ/bản mới. Khi server đổi version: xoá cache RAM + localStorage
  // rồi báo cho index.html xoá luôn gói boot cache (sự kiện xd-version-change).
  var VERSION_KEY = "xd_version_runtime";
  function docVersion() { try { return localStorage.getItem(VERSION_KEY) || ""; } catch (x) { return ""; } }
  function noteVersion(v) {
    if (!v) return;
    var moi = String(v), cu = docVersion();
    if (cu && cu !== moi) {
      window.gasCacheClear();
      try {
        var ev = new CustomEvent("xd-version-change", { detail: { tu: cu, den: moi } });
        window.dispatchEvent(ev);
      } catch (x) {
        try { window.dispatchEvent(new Event("xd-version-change")); } catch (x2) {}
      }
    }
    try { localStorage.setItem(VERSION_KEY, moi); } catch (x) {}
  }
  window.xdVersion = docVersion;

  // ---------- P4: invalidate theo namespace (thay gasCacheClear toàn cục) ----------
  // Sau một lệnh GHI chỉ bỏ cache của ĐỌC có liên quan, không dọn sạch mọi key
  // như gasCacheClear() cũ. Hàm nào chưa có trong bảng thì rơi về dọn toàn bộ
  // cache đọc cho an toàn (vẫn không đụng localStorage ngoài prefix xdc:).
  var WRITE_INVALIDATES = {
    quyGhiNhanThu: ["quyLayDanhSachTuan", "quyLayDanhSachChiThang", "quyLayMucDong", "quyLayTonQuyHienTai", "quyTrangThaiCaNhanHT", "pollTongHop", "xdCuaToi", "xdBootstrap"],
    quyHuyThu: ["quyLayDanhSachTuan", "quyLayDanhSachChiThang", "quyLayMucDong", "quyLayTonQuyHienTai", "quyTrangThaiCaNhanHT", "pollTongHop", "xdCuaToi", "xdBootstrap"],
    quyCapNhatMucDong: ["quyLayMucDong", "quyLayTonQuyHienTai", "xdCuaToi", "xdBootstrap"],
    admSetBaoTri: ["getAppConfigData", "layTrangThaiBaoTri", "xdChung", "xdCuaToi", "xdBootstrap"],
    capNhatCauHinh: ["getAppConfigData", "layTrangThaiBaoTri", "xdChung", "xdCuaToi", "xdBootstrap"],
    admGuiThongBaoChung: ["layThongBaoChung", "thongBaoLayNhacViec", "pollTongHop", "xdChung"],
    admThuHoiThongBaoChung: ["layThongBaoChung", "thongBaoLayNhacViec", "pollTongHop", "xdChung"],
    guiDonXinPhep: ["getMyLeaveRequests", "countPendingLeaveRequests", "pollTongHop", "xdCuaToi"],
    duyetDonXinPhep: ["getLeaveRequests", "getMyLeaveRequests", "countPendingLeaveRequests", "pollTongHop", "xdCuaToi"],
    admGuiBaiKiemTra: ["kiemTraDanhSachChoHT", "pollTongHop", "xdCuaToi"],
    admGanMaDe: ["kiemTraDanhSachChoHT", "kiemTraLichSuCuaToi", "xdCuaToi"]
  };
  function xoaCacheTheoFn(fn) {
    var prefix = fn + "|";
    for (var k in mem) {
      if (Object.prototype.hasOwnProperty.call(mem, k) && mem[k] && mem[k].key && mem[k].key.indexOf(prefix) === 0) delete mem[k];
    }
    try {
      var del = [];
      for (var i = 0; i < localStorage.length; i++) {
        var n = localStorage.key(i);
        if (!n || n.indexOf(CACHE_PREFIX) !== 0) continue;
        try {
          var e = JSON.parse(localStorage.getItem(n));
          if (e && e.key && e.key.indexOf(prefix) === 0) del.push(n);
        } catch (x) {}
      }
      del.forEach(function (n) { localStorage.removeItem(n); });
    } catch (x) {}
  }
  function invalidateAfterWrite(fn) {
    var danh = WRITE_INVALIDATES[fn];
    if (!danh) { window.gasCacheClear(); return; }
    for (var i = 0; i < danh.length; i++) xoaCacheTheoFn(danh[i]);
  }

  // ---------- thông báo nhỏ ----------
  function toast(msg) {
    var el = document.getElementById("gas-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "gas-toast";
      el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);" +
        "background:#323232;color:#fff;padding:10px 16px;border-radius:10px;font:500 14px/1.3 sans-serif;" +
        "z-index:2147483647;max-width:90%;text-align:center;box-shadow:0 4px 14px rgba(0,0,0,.35);display:none";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.style.display = "none"; }, 4000);
  }

  // ---------- gửi 1 request thật ----------
  var TRANSIENT_RE = /too many times|Service invoked|Exceeded maximum|timed out|Rate Limit|Service error|temporarily|bận/i;

  // Hàm ĐỌC không tham số được đệm sẵn ở máy chủ biên (api/gas.js) -> gọi
  // bằng GET, không tốn lượt chạy Apps Script. Lỗi là tự gọi thẳng như cũ.
  var EDGE = { layTrangThaiBaoTri: 1, getAppConfigData: 1, getHanhTrinhData: 1, xdChung: 1 };

  // ---------- backend SQL (chế độ hybrid) ----------
  // Giữ danh sách này khớp SQL_FN trong api/sql.js. Hàm không có ở đây vẫn đi
  // thẳng Apps Script, nên bật SQL không làm hỏng các tab khác.
  var SQL_FN = {
    admGiaoLyLayDuLieu: 1, glvLayTienDo: 1,
    admGiaoLyLuuNamHoc: 1, admGiaoLyLuuBai: 1, admGiaoLyXoaBai: 1,
    admGiaoLyDatLich: 1, admGiaoLyBoLich: 1, admGiaoLyCapNhatTuan: 1
  };
  // Chế độ "shadow" chỉ thử các hàm ĐỌC; hàm GHI vẫn đi Apps Script để tránh
  // ghi trùng hai nơi. Chế độ "sql" mới gửi cả ghi xuống /api/sql.
  var SQL_READ = { admGiaoLyLayDuLieu: 1, glvLayTienDo: 1 };
  function sqlCheDo() { return String(window.SQL_CHE_DO || "off").toLowerCase(); }

  function sendGas(fn, args, onOk, onErr, attempt) {
    var url = window.GAS_URL;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;

    function fail(err, transient) {
      if (timer) clearTimeout(timer);
      var e = err instanceof Error ? err : new Error(String(err));
      if (typeof navigator !== "undefined" && navigator.onLine === false) e = new Error("Không có kết nối mạng");
      if (transient && !attempt && isRead(fn)) {          // thử lại đúng 1 lần, chỉ với hàm đọc
        return setTimeout(function () { send(fn, args, onOk, onErr, 1); }, 900);
      }
      onErr(e);
    }

    if (!url || /PASTE_DEPLOYMENT_ID_HERE/.test(url)) return fail(new Error("Chưa cấu hình GAS_URL trong config.js"), false);

    // Content-Type text/plain => "simple request", không bị preflight (Apps Script không trả lời OPTIONS)
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ fn: fn, args: args }),
      redirect: "follow",
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { return r.text(); }).then(function (txt) {
      var data;
      try { data = JSON.parse(txt); }
      catch (e) { var er = new Error("Máy chủ trả về dữ liệu không hợp lệ (kiểm tra quyền truy cập 'Anyone' của Web app)"); er._t = true; throw er; }
      if (timer) clearTimeout(timer);
      if (!data.ok) { var e2 = new Error(data.error || "Lỗi máy chủ"); e2._t = TRANSIENT_RE.test(e2.message); throw e2; }
      noteVersion(data.version || (data.result && data.result.version));
      onOk(data.result);
    }).catch(function (err) {
      if (err && err.name === "AbortError") { err = new Error("Máy chủ phản hồi quá lâu"); err._t = true; }
      var transient = err && err._t !== undefined ? err._t : true; // lỗi mạng (fetch reject) coi là tạm thời
      fail(err, transient);
    });
  }

  // Gửi tới /api/sql (Supabase). Envelope trả về GIỐNG Apps Script {ok,result}.
  // Hàm ĐỌC nếu SQL lỗi thì tự rơi lại Apps Script; hàm GHI thì báo lỗi, KHÔNG
  // gọi lại Apps Script vì có thể đã ghi thành công ở SQL (tránh ghi trùng).
  function sendSql(fn, args, onOk, onErr, attempt) {
    var laDoc = !!SQL_READ[fn];
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    function quayVeGas(err) {
      if (timer) clearTimeout(timer);
      if (laDoc) return sendGas(fn, args, onOk, onErr, attempt);
      onErr(err);
    }
    fetch(location.origin + "/api/sql", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ fn: fn, args: args }),
      redirect: "follow",
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { return r.text(); }).then(function (txt) {
      if (timer) clearTimeout(timer);
      var data;
      try { data = JSON.parse(txt); }
      catch (e) { return quayVeGas(new Error("SQL trả dữ liệu không hợp lệ")); }
      if (!data || !data.ok) return quayVeGas(new Error((data && data.error) || "Lỗi SQL"));
      noteVersion(data.version || (data.result && data.result.version));
      onOk(data.result);
    }).catch(quayVeGas);
  }

  // Chọn đường: SQL (nếu bật) -> lớp đệm EDGE -> Apps Script trực tiếp.
  function send(fn, args, onOk, onErr, attempt) {
    var cheDo = sqlCheDo();
    if (cheDo !== "off" && SQL_FN[fn] &&
        (cheDo === "sql" || (cheDo === "shadow" && SQL_READ[fn]))) {
      return sendSql(fn, args, onOk, onErr, attempt);
    }
    var khongThamSo = !args || args.length === 0;
    if (!EDGE[fn] || !khongThamSo || !/^https?:$/.test(location.protocol)) {
      return sendGas(fn, args, onOk, onErr, attempt);
    }
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    function quayVeGas() {
      if (timer) clearTimeout(timer);
      sendGas(fn, args, onOk, onErr, attempt);
    }
    fetch(location.origin + "/api/gas?fn=" + encodeURIComponent(fn), {
      method: "GET",
      redirect: "follow",
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error("lop-dem " + r.status);
      return r.text();
    }).then(function (txt) {
      if (timer) clearTimeout(timer);
      var data;
      try { data = JSON.parse(txt); } catch (e) { quayVeGas(); return; }
      if (!data || !data.ok) { quayVeGas(); return; }
      noteVersion(data.version || (data.result && data.result.version));
      onOk(data.result);
    }).catch(function () { quayVeGas(); });
  }

  // ---------- P4: gửi 1 gói NHIỀU hàm đọc (op:"query") ----------
  // Không đi cache SWR/TTL: gói boot luôn lấy bản mới để kịp so version.
  function sendBatch(token, queries, onOk, onErr, attempt) {
    var url = window.GAS_URL;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    function fail(err, transient) {
      if (timer) clearTimeout(timer);
      var e = err instanceof Error ? err : new Error(String(err));
      if (typeof navigator !== "undefined" && navigator.onLine === false) e = new Error("Không có kết nối mạng");
      if (transient && !attempt) {
        return setTimeout(function () { sendBatch(token, queries, onOk, onErr, 1); }, 900);
      }
      onErr(e);
    }
    if (!url || /PASTE_DEPLOYMENT_ID_HERE/.test(url)) return fail(new Error("Chưa cấu hình GAS_URL trong config.js"), false);
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ op: "query", token: token, queries: queries }),
      redirect: "follow",
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { return r.text(); }).then(function (txt) {
      var data;
      try { data = JSON.parse(txt); }
      catch (e) { var er = new Error("Máy chủ trả về dữ liệu không hợp lệ"); er._t = true; throw er; }
      if (timer) clearTimeout(timer);
      if (!data.ok) { var e2 = new Error(data.error || "Lỗi máy chủ"); e2._t = TRANSIENT_RE.test(e2.message); throw e2; }
      noteVersion(data.version || (data.result && data.result.version));
      onOk(data.result);
    }).catch(function (err) {
      if (err && err.name === "AbortError") { err = new Error("Máy chủ phản hồi quá lâu"); err._t = true; }
      var transient = err && err._t !== undefined ? err._t : true;
      fail(err, transient);
    });
  }
  window.gasBatch = function (token, queries, ok, err) {
    sendBatch(token, queries, ok || function () {}, err || defaultErr("batchQuery"), 0);
  };

  // ---------- điều phối: cache / gộp / thử lại ----------
  var inflight = {};

  function defaultErr(fn) {
    return function (e) { console.error("[GAS] " + fn + ":", e); toast(e.message || "Lỗi kết nối máy chủ"); };
  }

  function call(fn, args, ok, err) {
    var onErr = err || defaultErr(fn);
    var key = fn + "|" + JSON.stringify(args);
    var read = isRead(fn);

    // (1) TTL: dùng lại trong thời gian ngắn, không gọi server
    if (TTL[fn]) {
      var t = cacheGet(key);
      if (t && Date.now() - t.t < TTL[fn]) { if (ok) setTimeout(function () { ok(t.v); }, 0); return; }
    }

    // (2) SWR: hiện ngay dữ liệu cũ, tải mới ở nền, chỉ báo lại nếu dữ liệu thực sự khác
    if (SWR[fn]) {
      var c = cacheGet(key);
      if (c && Date.now() - c.t < SWR_MAX_AGE) {
        if (ok) setTimeout(function () { ok(c.v); }, 0);
        send(fn, args, function (v) {
          cacheSet(key, v);
          if (ok && JSON.stringify(v) !== JSON.stringify(c.v)) ok(v);
        }, function () { /* lỗi ở nền: bỏ qua, người dùng đã có dữ liệu cũ */ }, 0);
        return;
      }
    }

    function done(v) {
      if (SWR[fn] || TTL[fn]) cacheSet(key, v);
      if (!read) invalidateAfterWrite(fn);                // P4: chỉ bỏ cache đọc liên quan, không clear toàn cục
      return v;
    }

    // (3) Gộp các lời gọi ĐỌC giống hệt nhau đang bay
    if (read) {
      if (inflight[key]) { inflight[key].push([ok, onErr]); return; }
      inflight[key] = [[ok, onErr]];
      send(fn, args, function (v) {
        var q = inflight[key]; delete inflight[key]; done(v);
        q.forEach(function (p) { if (p[0]) { try { p[0](v); } catch (x) { console.error(x); } } });
      }, function (e) {
        var q = inflight[key]; delete inflight[key];
        q.forEach(function (p) { try { p[1](e); } catch (x) { console.error(x); } });
      }, 0);
      return;
    }

    send(fn, args, function (v) { done(v); if (ok) ok(v); }, onErr, 0);
  }

  function makeRunner(ok, err) {
    return new Proxy({}, {
      get: function (_t, prop) {
        if (prop === "withSuccessHandler") return function (f) { return makeRunner(f, err); };
        if (prop === "withFailureHandler") return function (f) { return makeRunner(ok, f); };
        if (prop === "withUserObject") return function () { return makeRunner(ok, err); };
        if (typeof prop !== "string" || prop === "then") return undefined;
        return function () { call(prop, Array.prototype.slice.call(arguments), ok, err); };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunner(null, null);

  // ---------- vòng lặp nền tự tạm dừng khi app chạy ngầm ----------
  var _si = window.setInterval.bind(window), _ci = window.clearInterval.bind(window);
  var runners = {}, skipped = {};
  window.setInterval = function (fn, ms) {
    var extra = Array.prototype.slice.call(arguments, 2);
    if (typeof fn !== "function" || !(ms >= 2000)) return _si.apply(null, arguments);
    var id = _si(function () {
      if (document.hidden) { skipped[id] = true; return; }
      fn.apply(null, extra);
    }, ms);
    runners[id] = function () { fn.apply(null, extra); };
    return id;
  };
  window.clearInterval = function (id) { delete runners[id]; delete skipped[id]; return _ci(id); };
  function catchUp() {
    if (document.hidden) return;
    Object.keys(skipped).forEach(function (id) {
      delete skipped[id];
      if (runners[id]) { try { runners[id](); } catch (x) { console.error(x); } }
    });
  }
  document.addEventListener("visibilitychange", catchUp);

  // ---------- trạng thái mạng ----------
  // Việc báo/cập nhật phiên bản do khối "xd-capnhat" ở cuối index.html đảm nhiệm.
  window.addEventListener("offline", function () { toast("Đang offline — một số chức năng tạm dừng"); });
  window.addEventListener("online", function () { toast("Đã có mạng trở lại"); catchUp(); });
})();
