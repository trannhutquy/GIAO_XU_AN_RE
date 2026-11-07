/*
 * gas-shim.js — giả lập google.script.run bằng fetch tới Apps Script Web App,
 * kèm các tối ưu tốc độ:
 *   1. Cache "hiện ngay – cập nhật sau" cho các màn hình danh sách ít đổi
 *   2. Gộp các lời gọi đọc giống hệt nhau đang chạy cùng lúc
 *   3. Tự thử lại 1 lần khi lỗi mạng/lỗi tạm thời (chỉ với hàm ĐỌC, không bao giờ với hàm GHI)
 *   4. Các vòng lặp nền (setInterval >= 2 giây) tự tạm dừng khi app chạy ngầm, chạy bù khi quay lại
 */
(function () {
  "use strict";
  var TIMEOUT_MS = 90000;

  // ---------- phân loại hàm ----------
  // Hàm ĐỌC: an toàn để thử lại / gộp. Mọi hàm khác coi là hàm GHI.
  var READ_RE = /^(get|poll|count|admLay|quyLay|thiDuaLay|vanBanLay|soBoHTLay|htLay|layDanh|layThongTin|layTrangThai|layDiem|kiemTraDanhSach|kiemTraLich|admKiemTraDanhSach|admKiemTraChiTiet|admKiemTraThongKe|admThiDuaLichSu|admThiDuaDanhSach|admChucVuDanhSach|adminLay)/;
  // Màn hình hiện ngay dữ liệu cũ rồi cập nhật dữ liệu mới (tối đa 24 giờ tuổi)
  var SWR = { getHanhTrinhData: 1, getCTTTData: 1, vanBanLayDanhSach: 1, soBoHTLayDanhSach: 1,
              thiDuaLayBangXepHang: 1, getDanhSachThieuNhi: 1, getToanBoDanhSach: 1 };
  var SWR_MAX_AGE = 24 * 3600 * 1000;
  // Cấu hình ít đổi: dùng lại trong 5 phút, không gọi server
  var TTL = { getAppConfigData: 5 * 60 * 1000 };
  var CACHE_PREFIX = "xdc:";
  var MAX_ENTRY_CHARS = 400000;

  function isRead(fn) { return READ_RE.test(fn); }

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

  function send(fn, args, onOk, onErr, attempt) {
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
      onOk(data.result);
    }).catch(function (err) {
      if (err && err.name === "AbortError") { err = new Error("Máy chủ phản hồi quá lâu"); err._t = true; }
      var transient = err && err._t !== undefined ? err._t : true; // lỗi mạng (fetch reject) coi là tạm thời
      fail(err, transient);
    });
  }

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
      if (!read) window.gasCacheClear();                  // vừa GHI dữ liệu -> bỏ cache cũ cho chắc
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
