// Service worker: má»Ÿ app Tá»¨C THÃŒ tá»« bá»™ nhá»› mÃ¡y, táº£i báº£n má»›i á»Ÿ ná»n, bÃ¡o khi cÃ³ báº£n má»›i,
// vÃ  nháº­n THÃ”NG BÃO Äáº¨Y (Firebase Cloud Messaging) ká»ƒ cáº£ khi app Ä‘ang Ä‘Ã³ng.
var VERSION = "v73";
var SHELL = "shell-" + VERSION;
var STATIC = "static-" + VERSION;
var SHELL_FILES = ["./", "index.html", "config.js", "pv-domain.js", "gas-shim.js", "push.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/hill-v2.png", "icons/hill-community.png",
  "icons/banner-quang-cao-1.webp", "icons/banner-quang-cao-2.webp", "icons/banner-quang-cao-3.webp",
  "vendor/jsqr.js", "vendor/qrcode-generator.js"];
var CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
var daBao = false;

// ---------- ThÃ´ng bÃ¡o Ä‘áº©y ----------
// importScripts lá»—i (chÆ°a cÃ³ file cáº¥u hÃ¬nh / máº¥t máº¡ng lÃºc cÃ i) thÃ¬ bá» qua, pháº§n cÃ²n láº¡i cá»§a app váº«n cháº¡y.
try { importScripts("push-config.js", "firebase-app-compat.js", "firebase-messaging-compat.js"); } catch (e) {}

function hienThongBao(d) {
  d = d || {};
  return self.registration.showNotification(d.title || "Xá»© ÄoÃ n", {
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
    // Tin gá»­i dáº¡ng "data": tá»± hiá»ƒn thá»‹ á»Ÿ Ä‘Ã¢y khi khÃ´ng cÃ³ cá»­a sá»• app nÃ o Ä‘ang Ä‘Æ°á»£c nhÃ¬n
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

// ---------- Cache / cáº­p nháº­t ----------
// Báº£n má»›i cÃ i xong sáº½ á»ž TRáº NG THÃI CHá»œ, khÃ´ng tá»± chiáº¿m quyá»n: app hiá»‡n tháº» nháº¯c,
// ngÆ°á»i dÃ¹ng báº¥m "Cáº­p nháº­t ngay" thÃ¬ gá»­i SKIP_WAITING -> kÃ­ch hoáº¡t -> trang tá»± táº£i láº¡i.
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    return c.addAll(SHELL_FILES);
  }).then(function () {
    // BÃ¡o cho trang Ä‘ang má»Ÿ biáº¿t Ä‘Ã£ cÃ³ báº£n má»›i (ká»ƒ cáº£ khi trang bá» lá»¡ sá»± kiá»‡n updatefound)
    return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) {
      cs.forEach(function (c) { c.postMessage({ type: "update-ready" }); });
    });
  }));
});

// Trang gá»i khi ngÆ°á»i dÃ¹ng báº¥m "Cáº­p nháº­t ngay"
self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
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
  if (req.method !== "GET") return;                       // POST tá»›i Apps Script: khÃ´ng Ä‘á»¥ng vÃ o
  if (url.hostname.indexOf("google.com") !== -1 && url.pathname.indexOf("/macros/") === 0) return;
  // Lá»›p Ä‘á»‡m /api/gas: luÃ´n ra máº¡ng, KHÃ”NG lÆ°u vÃ o cache cá»§a app (cáº§n dá»¯ liá»‡u tÆ°Æ¡i)
  if (url.origin === location.origin && url.pathname.indexOf("/api/") === 0) return;

  if (url.origin === location.origin) {                   // file cá»§a app: tráº£ báº£n cache NGAY, cáº­p nháº­t ngáº§m
    // Má»Ÿ app tá»« thÃ´ng bÃ¡o cÃ³ dáº¡ng index.html?mo=don -> dÃ¹ng chung 1 báº£n cache vá»›i index.html
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

  if (CDN_HOSTS.indexOf(url.hostname) !== -1) {           // thÆ° viá»‡n/font: cache trÆ°á»›c, cáº­p nháº­t ngáº§m
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
