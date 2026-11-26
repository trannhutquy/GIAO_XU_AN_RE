// ==========================================================
// P2 - DOMAIN: LỊCH PHỤNG VỤ CÔNG GIÁO (thuần, không hạ tầng)
// ----------------------------------------------------------
// Nguồn luật DUY NHẤT cho cả server (file này được gộp vào CODE.txt)
// và PWA (copy nguyên sang _preview/pv-domain.js). Client vẫn tính tại máy
// để lịch mở được khi mất mạng — chỉ khác là rule không còn nằm rải rác
// trong index.html nữa.
// ==========================================================
var XD = (typeof window !== "undefined" && window.XD) ? window.XD : (typeof XD !== "undefined" ? XD : {});
if (typeof window !== "undefined") window.XD = XD;
XD.Domain = XD.Domain || {};

XD.Domain.LichPhungVu = {
  TEN_MAU: {
    xanh: "Xanh lá (Thường niên)", tim: "Tím (Vọng / Chay)",
    trang: "Trắng (Giáng Sinh / Phục Sinh)", do: "Đỏ (Chúa Thánh Thần / Tử đạo)",
    hong: "Hồng (Gaudete / Laetare)", den: "Đen (Các Linh Hồn)"
  },
  LE_CO_DINH: {
    "1-1": ["Đức Mẹ Làm Mẹ Chúa Trời", "trang"],
    "1-6": ["Hiển Linh", "trang"],
    "2-2": ["Dâng Chúa trong đền thờ", "trang"],
    "2-11": ["Đức Mẹ Lourdes", "trang"],
    "3-19": ["Thánh Giuse", "trang"],
    "3-25": ["Truyền Tin", "trang"],
    "5-1": ["Thánh Giuse Thợ", "trang"],
    "5-13": ["Đức Mẹ Fatima", "trang"],
    "6-29": ["Thánh Phêrô và Phaolô", "do"],
    "7-16": ["Đức Mẹ Núi Carmel", "trang"],
    "8-15": ["Đức Mẹ Lên Trời", "trang"],
    "9-8": ["Sinh nhật Đức Mẹ", "trang"],
    "9-14": ["Tôn vinh Thánh Giá", "do"],
    "10-7": ["Đức Mẹ Mân Côi", "trang"],
    "11-1": ["Các Thánh", "trang"],
    "11-2": ["Các Linh Hồn", "den"],
    "11-21": ["Dâng Đức Mẹ trong đền thờ", "trang"],
    "12-8": ["Đức Mẹ Vô Nhiễm Nguyên Tội", "trang"],
    "12-12": ["Đức Mẹ Guadalupe", "trang"],
    "12-25": ["Giáng Sinh", "trang"],
    "12-26": ["Thánh Stêphanô", "do"],
    "12-27": ["Thánh Gioan Tông đồ", "trang"],
    "12-28": ["Các Thánh Anh Hài", "do"]
  },
  ngay: function (nam, thang, ngay) { return new Date(nam, thang, ngay, 12, 0, 0); },
  themNgay: function (d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; },
  soNgay: function (a, b) { return Math.round((a.getTime() - b.getTime()) / 86400000); },
  sanh: function (a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  },
  khoa: function (d) { return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); },
  phucSinh: function (nam) {
    var a = nam % 19, b = Math.floor(nam / 100), c = nam % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var thang = Math.floor((h + l - 7 * m + 114) / 31);
    var ngay = ((h + l - 7 * m + 114) % 31) + 1;
    return XD.Domain.LichPhungVu.ngay(nam, thang - 1, ngay);
  },
  chuaNhatVong: function (nam) {
    var DK = XD.Domain.LichPhungVu;
    var d = DK.ngay(nam, 10, 27);
    return DK.themNgay(d, (7 - d.getDay()) % 7);
  },
  bapGiuoc: function (nam) {
    var DK = XD.Domain.LichPhungVu;
    var d = DK.ngay(nam, 0, 7);
    return DK.themNgay(d, (7 - d.getDay()) % 7);
  },
  thongTinNgay: function (d) {
    var DK = XD.Domain.LichPhungVu;
    // Chuẩn hoá về trưa cùng ngày để so sánh không bị lệch do giờ (00:00 / 12:00).
    d = DK.ngay(d.getFullYear(), d.getMonth(), d.getDate());
    var nam = d.getFullYear(), ps = DK.phucSinh(nam);
    var laCN = d.getDay() === 0;
    var namPhungVu = (d.getMonth() === 0 && d < DK.bapGiuoc(nam)) ? nam - 1 : nam;
    var chuKy = namPhungVu % 3 === 1 ? "A" : (namPhungVu % 3 === 2 ? "B" : "C");
    var ky = laCN ? " (năm " + chuKy + ")" : "";
    var kq = { ten: "", ma: "xanh", loai: "Thường niên" };

    var lua = DK.themNgay(ps, -7), thangSauTot = DK.themNgay(ps, -2);
    var chuaThanThan = DK.themNgay(ps, 49), baNguy = DK.themNgay(ps, 56);
    var dauVong = DK.chuaNhatVong(nam), cuoiVong = DK.chuaNhatVong(nam + 1);
    var dauChay = DK.themNgay(ps, -46);
    var giangSinh = DK.ngay(nam, 11, 25), ketThucGS = DK.bapGiuoc(nam + 1);

    if (d >= lua && d <= thangSauTot) {
      kq.loai = "Tuần Thánh"; kq.ma = "tim";
      if (DK.sanh(d, lua)) { kq.ten = "Chúa Nhật Lá" + ky; kq.ma = "do"; }
      else if (DK.sanh(d, thangSauTot)) { kq.ten = "Thứ Sáu Tuần Thánh"; kq.ma = "do"; }
      else if (DK.sanh(d, DK.themNgay(ps, -1))) { kq.ten = "Thứ Năm Tuần Thánh"; kq.ma = "trang"; }
    } else if (d >= ps && d <= chuaThanThan) {
      kq.loai = "Mùa Phục Sinh"; kq.ma = "trang";
      if (laCN) {
        if (DK.sanh(d, ps)) kq.ten = "Chúa Nhật Phục Sinh" + ky;
        else if (DK.sanh(d, baNguy)) kq.ten = "Chúa Nhật Ba Ngôi" + ky;
        else kq.ten = "Chúa Nhật Phục Sinh tuần " + (DK.soNgay(d, ps) / 7 + 1) + ky;
      }
    } else if (d >= giangSinh && d < ketThucGS) {
      kq.loai = "Mùa Giáng Sinh"; kq.ma = "trang";
      if (laCN) kq.ten = "Chúa Nhật Giáng Sinh" + ky;
    } else if (d >= dauVong && d < cuoiVong) {
      kq.loai = "Mùa Vọng"; kq.ma = "tim";
      if (laCN) {
        var tuanVong = DK.soNgay(d, dauVong) / 7 + 1;
        kq.ten = "Chúa Nhật " + tuanVong + " Mùa Vọng" + ky;
        if (tuanVong === 3) kq.ma = "hong";
      }
    } else if (d.getMonth() === 0 && d < DK.bapGiuoc(nam)) {
      kq.loai = "Mùa Giáng Sinh"; kq.ma = "trang";
      if (laCN) kq.ten = "Chúa Nhật Giáng Sinh" + ky;
    } else if (d >= dauChay && d < lua) {
      kq.loai = "Mùa Chay"; kq.ma = "tim";
      if (laCN) {
        var tuanChay = Math.floor((DK.soNgay(d, dauChay) + 3) / 7);
        kq.ten = "Chúa Nhật " + tuanChay + " Mùa Chay" + ky;
        if (tuanChay === 4) kq.ma = "hong";
      }
    } else {
      kq.loai = "Thường niên"; kq.ma = "xanh";
      if (laCN) kq.ten = "Chúa Nhật Thường niên" + ky;
    }

    var leDong = {};
    leDong[DK.khoa(ps)] = ["Chúa Nhật Phục Sinh", "trang"];
    leDong[DK.khoa(DK.themNgay(ps, 39))] = ["Chúa lên trời", "trang"];
    leDong[DK.khoa(chuaThanThan)] = ["Chúa Thánh Thần hiện xuống", "do"];
    leDong[DK.khoa(baNguy)] = ["Chúa Ba Ngôi", "trang"];
    leDong[DK.khoa(DK.themNgay(ps, 60))] = ["Mình và Máu Chúa Kitô", "trang"];
    leDong[DK.khoa(DK.themNgay(ps, 68))] = ["Thánh Tâm Chúa", "trang"];
    // Lễ cố định tra theo tháng-ngày; lễ động (Phục Sinh...) tra theo ngày đầy đủ.
    var khoa = DK.khoa(d);
    var le = DK.LE_CO_DINH[(d.getMonth() + 1) + "-" + d.getDate()] || leDong[khoa];
    if (le) { kq.ten = le[0]; kq.ma = le[1]; }
    if (!kq.ten) kq.ten = "Ngày thường";
    return kq;
  }
};
