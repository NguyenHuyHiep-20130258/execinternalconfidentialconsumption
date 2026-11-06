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

- Repo này **không** chứa dữ liệu nhà máy. Trên trang web, mỗi người tự nhập Report và định mức; dữ liệu chỉ lưu trong trình duyệt của người đó (localStorage). Nên tải bản sao lưu định kỳ.
- `index.html` là trang đã được mã hóa bằng mật khẩu (PBKDF2-SHA256, AES-GCM). Mật khẩu không được ghi trong repo.
- Mật khẩu chặn người không biết mật khẩu mở trang. Vì mã nguồn trong `src/` vẫn công khai, đừng đưa dữ liệu thật vào repo.

## Bật GitHub Pages (làm một lần)

Settings → Pages → Build and deployment → Source: **Deploy from a branch** → Branch: **main**, thư mục **/ (root)** → Save. Sau 1–2 phút trang chạy ở địa chỉ trên.

## Sửa và build lại

```bash
PAGE_PASSWORD='mật khẩu' python3 build.py   # tạo lại index.html cho GitHub Pages (cần: pip install cryptography)
python3 build.py --artifact                 # dist/artifact.html: bản đăng lên claude.ai, kèm data/seed.json nếu có
python3 build.py --local                    # dist/local.html: bản dùng riêng có dữ liệu, không mật khẩu
node tests/test_core.js                     # kiểm tra tổng Actual/Report (cần data/seed.json)
```

Đổi mật khẩu: chạy lại lệnh đầu với mật khẩu mới rồi commit `index.html`.

| Đường dẫn | Nội dung |
|---|---|
| `src/core.js` | Logic thuần: danh mục hóa chất từ Report, tính Comparison, đọc sheet Daily Report |
| `src/app.js` | Giao diện, lưu dữ liệu, các thao tác |
| `src/page.tmpl.html` | CSS và khung trang |
| `src/gate.tmpl.html` | Trang nhập mật khẩu |
| `build.py` | Ghép và mã hóa thành `index.html` |
| `data/` | Dữ liệu nhà máy (chỉ có trên máy, không đưa lên repo) |

## Cách tính

- Actual (kg) = g/prs × Total prs / 1000, cộng theo hóa chất trong tuần đang xem.
- Report (kg) = Σ(Output − DVL) các ngày trong khoảng của tuần; Stock lấy ở ngày cuối.
- WASTE CHEMICAL tính riêng, không vào tổng hóa chất.
