# Đối chiếu hóa chất (Chemical consumption)

Trang web để đối chiếu lượng hóa chất **Actual** (định mức g/prs × Total prs của từng model) với **Report** (Output − DVL trong Chemical Daily Report) cho phòng pha keo F1 (Mixing Room 1) và F2 (Mixing Room 2).

**Trang web:** https://nguyenhuyhiep-20130258.github.io/execinternalconfidentialconsumption/ (cần mật khẩu)

## Chức năng

- **Comparison**: Actual, Report, tỷ lệ Actual/Report và Stock ngày cuối cho từng hóa chất. Bấm một dòng để xem mọi model đang chạy chất đó; sửa g/prs hoặc Total prs thì Actual cộng lại ngay.
- **Đổi chất**: dòng có Actual nhưng Report không có được đánh dấu. Chọn model rồi đổi sang chất đúng trong Report, có gợi ý chất gần giống và hoàn tác.
- **Model (Summary)**: nhập định mức theo tuần. Hóa chất chọn từ danh sách chất trong Daily Report (kèm mã vật tư). Có dán nhanh 2 cột từ Excel.
- **Tuần**: mỗi tuần có định mức và Total prs riêng. "Xác nhận tuần" khóa định mức tuần đó; tuần mới chép từ tuần trước.
- **Tháng**: chọn tháng, xem từng tuần hoặc gộp cả tháng.
- **Report**: nhập file Chemical Daily Report (.xls/.xlsx, nhiều file, nhiều tháng). Mỗi sheet ngày (vd. `26.10`) là một ngày; trang tự nhận F1/F2, bỏ qua sheet mẫu và `DEVELOP`.
- **Sao lưu**: tải toàn bộ dữ liệu ra file .json và khôi phục lại (dùng để chuyển máy).

## Dữ liệu và mật khẩu

- `index.html` là trang đã được mã hóa bằng mật khẩu (PBKDF2-SHA256, AES-GCM). Mật khẩu không được ghi trong repo.
- `index.html` trong repo được build với `--with-data`: dữ liệu ban đầu (định mức F1 19–24/10, F2 26–31/10, Report tháng 10/2026) nằm **bên trong** phần mã hóa, chỉ đọc được sau khi nhập đúng mật khẩu.
- File dữ liệu gốc `data/seed.json` không đưa lên repo, vì để dạng chữ rõ thì mật khẩu không còn tác dụng.
- Khi build có `SYNC_URL`, mọi thay đổi được lưu chung trong một Google Sheet (xem mục dưới) và mọi trình duyệt tự cập nhật khoảng 30 giây một lần. Không có `SYNC_URL` thì dữ liệu chỉ nằm trong trình duyệt của từng người (localStorage).

## Đồng bộ qua Google Sheets

1. Tạo một Google Sheet → Extensions → Apps Script → dán `apps-script/Code.gs` → Save.
2. Project Settings → Script properties → thêm `PASSWORD` = mật khẩu của trang.
3. Deploy → New deployment → Web app; Execute as: **Me**, Who has access: **Anyone** → Deploy, cấp quyền.
4. Build lại với link Web app: `SYNC_URL='https://script.google.com/macros/s/…/exec' PAGE_PASSWORD='…' python3 build.py --with-data`.

Mỗi tài liệu (bảng Comparison, một tuần, một ngày Report) là một dòng trong sheet `data`. Lần đầu sheet còn trống, trang tự đưa dữ liệu ban đầu lên. Apps Script kiểm tra mật khẩu ở phía Google; link Web app nằm trong phần đã mã hóa của `index.html`. Nếu hai người sửa cùng một tuần cùng lúc, bản lưu sau cùng thắng.

## Bật GitHub Pages (làm một lần)

Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch: **main**, thư mục **/ (root)** → Save. Sau 1–2 phút trang chạy ở địa chỉ trên.

## Sửa và build lại

```bash
PAGE_PASSWORD='mật khẩu' python3 build.py --with-data   # tạo lại index.html cho GitHub Pages, kèm dữ liệu (cần: pip install cryptography)
python3 build.py --artifact                 # dist/artifact.html: bản đăng lên claude.ai, kèm data/seed.json nếu có
python3 build.py --local                    # dist/local.html: bản dùng riêng có dữ liệu, không mật khẩu
node tests/test_core.js                     # kiểm tra tổng Actual/Report (cần data/seed.json)
```

Đổi mật khẩu: chạy lại lệnh đầu với mật khẩu mới rồi commit `index.html`. Bỏ `--with-data` nếu muốn trang trống, không kèm dữ liệu.

| Đường dẫn | Nội dung |
|---|---|
| `src/core.js` | Logic thuần: danh mục hóa chất từ Report, tính Comparison, đọc sheet Daily Report |
| `src/app.js` | Giao diện, lưu dữ liệu, các thao tác |
| `src/page.tmpl.html` | CSS và khung trang |
| `src/gate.tmpl.html` | Trang nhập mật khẩu |
| `build.py` | Ghép và mã hóa thành `index.html` |
| `apps-script/Code.gs` | Kho dữ liệu chung trên Google Sheets (Apps Script web app) |
| `data/` | Dữ liệu nhà máy dạng rõ (chỉ có trên máy, không đưa lên repo; bản mã hóa nằm trong `index.html`) |

## Cách tính

- Actual (kg) = g/prs × Total prs / 1000, cộng theo hóa chất trong tuần đang xem.
- Report (kg) = Σ(Output − DVL) các ngày trong khoảng của tuần; Stock lấy ở ngày cuối.
- WASTE CHEMICAL tính riêng, không vào tổng hóa chất.
