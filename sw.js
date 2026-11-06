// Service worker: mở app TỨC THÌ từ bộ nhớ máy, tải bản mới ở nền, báo khi có bản mới,
// và nhận THÔNG BÁO ĐẨY (Firebase Cloud Messaging) kể cả khi app đang đóng.
var VERSION = "v10";
var SHELL = "shell-" + VERSION;
var STATIC = "static-" + VERSION;
var SHELL_FILES = ["./", "index.html", "config.js", "gas-shim.js", "push.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/logo-dai-dien.jpg"];
var CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
var daBao = false;

// ---------- Thông báo đẩy ----------
// importScripts lỗi (chưa có file cấu hình / mất mạng lúc cài) thì bỏ qua, phần còn lại của app vẫn chạy.
try { importScripts("push-config.js", "firebase-app-compat.js", "firebase-messaging-compat.js"); } catch (e) {}

function hienThongBao(d) {
  d = d || {};
  return self.registration.showNotification(d.title || "Xứ Đoàn", {
    body: d.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    lang: "vi",
    data: { mo: d.mo || "" }
  });
}
try {
  var c = self.FIREBASE_CONFIG;
  if (self.firebase && c && c.apiKey && !/DAN_VAO/i.test(JSON.stringify(c))) {
    firebase.initializeApp(c);
    // Tin gửi dạng "data": tự hiển thị ở đây khi không có cửa sổ app nào đang được nhìn
    firebase.messaging().onBackgroundMessage(function (payload) { return hienThongBao((payload && payload.data) || {}); });
  }
} catch (e) {}

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var mo = (e.notification.data && e.notification.data.mo) || "";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) {
      if ("focus" in cs[i]) { cs[i].postMessage({ type: "mo-man-hinh", mo: mo }); return cs[i].focus(); }
    }
    return self.clients.openWindow("./index.html" + (mo ? "?mo=" + encodeURIComponent(mo) : ""));
  }));
});

// ---------- Cache / cập nhật ----------
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(SHELL_FILES); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== STATIC; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function dau(res) {
  return res ? (res.headers.get("etag") || res.headers.get("last-modified") || res.headers.get("content-length")) : null;
}
function baoCoBanMoi() {
  if (daBao) return;
  daBao = true;
  self.clients.matchAll().then(function (cs) { cs.forEach(function (c) { c.postMessage({ type: "update-ready" }); }); });
}

self.addEventListener("fetch", function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;                       // POST tới Apps Script: không đụng vào
  if (url.hostname.indexOf("google.com") !== -1 && url.pathname.indexOf("/macros/") === 0) return;

  if (url.origin === location.origin) {                   // file của app: trả bản cache NGAY, cập nhật ngầm
    // Mở app từ thông báo có dạng index.html?mo=don -> dùng chung 1 bản cache với index.html
    var key = (req.mode === "navigate" && url.search) ? new Request(url.origin + url.pathname) : req;
    e.respondWith(caches.open(SHELL).then(function (cache) {
      return cache.match(key).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) {
            var cu = dau(hit), moi = dau(res);
            cache.put(key, res.clone());
            if (hit && cu && moi && cu !== moi) baoCoBanMoi();
          }
          return res;
        }).catch(function () { return hit || cache.match("index.html"); });
        return hit || net;
      });
    }));
    return;
  }

  if (CDN_HOSTS.indexOf(url.hostname) !== -1) {           // thư viện/font: cache trước, cập nhật ngầm
    e.respondWith(caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === "opaque")) {
          var copy = res.clone();
          caches.open(STATIC).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    }));
  }
});
