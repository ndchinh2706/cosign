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
- Lỗi nhỏ còn tồn từ review: toast ở E5 autoplay chạm tab CR-0195; dưới 1920px header A1 xuống dòng (quay video ở 1920×1080).
