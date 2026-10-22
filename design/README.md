# Prototype từ Claude Design

Export từ project Claude Design "Câu hỏi prototype design" (22/10). Mở `prototype/Cosign.dc.html` bằng trình duyệt để xem đủ 23 màn, role switcher và storyboard 16 beat (← → để chuyển beat, P để autoplay, H để ẩn thanh demo).

Đây là **tài liệu tham chiếu để port**, không phải code chạy production. Khi port sang `web/` (Next.js), giữ nguyên visual và copy, thay phần dữ liệu bằng client theo `docs/API.md`.

## Map file → nơi port

| File prototype | Port sang | Ghi chú |
|---|---|---|
| `cosign/store.js` | store client trong `web/` | state tập trung + logic storyboard; ở live mode state lấy từ REST + WS |
| `cosign/api.js` | API client `web/` | mỗi hàm đã ghi chú endpoint thật theo `docs/API.md` |
| `cosign/data.js` | `docs/mocks/` | dữ liệu mẫu; nguồn chuẩn là `docs/mocks/*.json` |
| `QuorumSeal`, `RiskChip`, `IdentityChip`, `Cosign AuthorityMeter`, `Cosign RequestReview` | component dùng chung | xem `docs/SCREENS.md` danh sách component |
| `Cosign Agent` | A1–A6 | tab Agent Console xử lý `tool_call` → `IAMService.doDecrypt` |
| `Cosign SRE`, `Cosign Mobile` | E1–E5 | |
| `Cosign Security` | L1–L4 | |
| `Cosign Admin` | R1–R4 | R3 Compare views là beat chính của video |
| `Cosign Compliance` | C1–C2 | |
| `support.js` | không port | runtime của Claude Design |

## Lệch giữa prototype và contract

- Prototype mock giải mã bằng một endpoint server (`decrypt`). Contract thật: server chỉ trả ciphertext (`GET /records`), giải mã ở trình duyệt bằng `IAMService.doDecrypt`, sau đó báo `POST /records/access-log`.
- Prototype gọi change request là `/change-requests`; contract dùng `/requests` và `PUT /admin/users/{username}/roles` → `202 quorum_required`.
- Lỗi header A1 xuống dòng dưới 1920px đã sửa (rail 56px thay sidebar 232px). Toast giờ nằm ngay dưới top bar.

## Rework theo taste skill (22/10)

Style `data-terminal` (tasteskill app sheet, seed 535256986), dark + light qua `[data-theme]`.

- Token ở helmet `Cosign.dc.html`, giữ tên biến cũ (`--bg --surface --surface2 --border --text --muted --accent --ok --pending --refused --warn --agent`), thêm `--primary --on-fill --rule --control --font --mono`. #17 chép khối này sang `web/src/app/globals.css`.
- Font: Public Sans cho chữ và số (tabular). JetBrains Mono chỉ cho ID, hash, role, tool call, log.
- Accent xanh `#4a8ad6` / `#2f6fbd` chỉ dùng cho vạch chọn 1px, cung QuorumSeal và dữ liệu đang có chữ ký ngưỡng. Agent màu xám (avatar lục giác), người giữ màu riêng. Bỏ indigo/tím.
- Bỏ gradient, glow, blur, emoji, nhãn mono viết hoa, ô icon tô màu, chấm nhấp nháy. Nút chính là `--primary` (trắng trên dark, đen trên light).
- Shell: icon rail 56px (bấm nút collapse để mở nhãn), top bar ghi scope `Northwind Pay · northwind-prod`. Dưới 640px rail thành bottom bar.
- Mở thẳng một beat: `Cosign.dc.html?beat=10&theme=light&bar=0` (beat đánh số từ 0, `bar=0` ẩn thanh storyboard).
