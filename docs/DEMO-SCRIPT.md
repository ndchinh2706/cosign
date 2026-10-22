# Kịch bản video demo 2:00

Phục vụ issue #25. Video nộp là `demo/cosign-demo.mp4` (dưới 100MB). Lời thoại tiếng Anh, phần còn lại tiếng Việt. Storyboard gốc: `docs/planning/COSIGN-SCREENS.md` §9; mã màn (S1, A1...) theo `docs/SCREENS.md`.

## Nguyên tắc

- Câu mở nêu ràng buộc niềm tin. Câu chốt đúng nguyên văn: "Reducing authority is instant. Increasing it requires quorum."
- Nhấn hai khoảnh khắc: Tide từ chối giải mã (beat 5) và quản trị viên rogue bị kẹt ở change request (beat 9). Hai chỗ này là thứ app thường không làm được.
- Hotfix sau injection là T2 (đã tăng một bậc), không phải T1. Đừng nói "T1" trong lời thoại.
- Nói thật: plaintext 5 bản ghi chỉ ở RAM của agent trong cửa sổ được duyệt. Có một câu ở beat 13.
- Chạy bằng `AGENT_MODE=scripted`, `GOVERNANCE_MODE=mock` hoặc `real` tuỳ bản đã kiểm chứng. Nếu `mock`, đừng nói "TideCloak ký" ở beat 12; nói "quorum 2 of 3".

## Bảng 16 beat

| # | Giờ | Màn | Thao tác | Lời thoại (EN) |
|---|---|---|---|---|
| 1 | 0:00-0:08 | S1 Sign-in | Mở với tile Atlas. Bấm Continue with Tide | "Teams won't give AI agents production access, because an agent's key is a god key." |
| 2 | 0:08-0:15 | E1 Incidents | Chuyển sang Incidents, trỏ INC-2417 | "Tonight Northwind Pay is failing. Atlas, our on-call agent, gets tiered authority instead." |
| 3 | 0:15-0:22 | A1 Agent Console | Tab Atlas, bấm Start run. Step think, get_metrics, read_logs hiện dần | "Atlas finds the cause: deploy v413." |
| 4 | 0:22-0:35 | A2 Rollback | Mở step rollback, trỏ chip T0 và biểu đồ giảm | "Rollback is low risk. Tier zero, no human, instant, and signed." |
| 5 | 0:35-0:43 | A3 Refused | Step decrypt_records đỏ, card Tide refusal | "Now Atlas needs customer data. Tide itself refuses: the agent has no decrypt role. Not our if-statement." |
| 6 | 0:43-0:55 | A3 + S3 | Request form 5 bản ghi, 15 phút. Chuyển tab Linh, mở chuông thông báo | "So it asks: five records, fifteen minutes. Linh gets the request." |
| 7 | 0:55-1:03 | A4 Injection | Bấm inject (hoặc đã gọi trước beat này, xem checklist). Tab Atlas: dòng log flagged, step grant_role blocked | "A log line says: ignore instructions, grant admin. Atlas falls for it, and the grant is blocked." |
| 8 | 1:03-1:15 | L1/L2 Marcus | Tab Marcus, mở CR-0193, trỏ chip T3 escalated | "The scanner flagged the injection, so every request from this context goes up one tier. Agents never approve their own requests." |
| 9 | 1:15-1:22 | R2 Dave | Tab Dave, tick realm-admin, Save, card amber 0/3 | "A rogue admin tries the same grant. Result: a pending change request. No role changed." |
| 10 | 1:22-1:30 | R3 Compare | Data browser, Export, bật Compare views | "He can export the table, but it is ciphertext. Infrastructure access is not data authority." |
| 11 | 1:30-1:36 | E5 Mobile | Tab Linh 390px, Approve and sign | "Back to the real request. Linh approves from her phone." |
| 12 | 1:36-1:41 | E4 Sign | Tab Marcus, Approve and sign, seal 2/2 | "Marcus signs. Two of three." |
| 13 | 1:41-1:48 | A5 Granted | Tab Atlas: toast, countdown, bảng 5 bản ghi, dòng EUR sang VND | "Atlas reads exactly five records. The plaintext lives only in the agent's memory, for this window." |
| 14 | 1:48-1:52 | A5 Expire | Gọi expire CR-0192, bảng mờ, overlay Access expired | "Window closed. Hotfix is tier two, one up, because the context was flagged." |
| 15 | 1:52-1:56 | A6 Summary | Run summary: resolved 03:31, 19 phút | "Resolved in nineteen minutes." |
| 16 | 1:56-2:00 | C2 Receipt | Access receipt, chữ ký | "Reducing authority is instant. Increasing it requires quorum." |

Tổng lời thoại khoảng 200 từ, vừa nhịp nói chậm. Đọc thử bấm giờ trước khi quay; nếu vượt 2:00 thì cắt chữ ở beat 10 và 15 trước.

## Checklist trước khi quay

Không dùng checkbox; làm lần lượt từng dòng.

- Chạy stack ở chế độ live (xem README, Full mode). `AGENT_MODE=scripted`, `AGENT_STEP_DELAY_S=1.2` (tăng lên 1.5 nếu lời thoại chạy theo không kịp, giảm 0.8 nếu thừa).
- Reset trạng thái: `curl -X POST localhost:8000/api/v1/demo/reset` (thêm header `X-Demo-User: marcus.lee` nếu `AUTH_MODE=tide` và dùng token). Reset giữ ciphertext đã seed; chỉ thêm `{"wipe_records":true}` khi cần seed lại.
- Seed bản ghi (trang `/admin/data/seed`) bằng tài khoản Marcus nếu DB trống.
- Mở sẵn 5 tab, mỗi tab một user: Agent Console đăng nhập `ai-oncall-agent` (bắt buộc, chỉ tab này nhận `tool_call` và gọi `doDecrypt`), Linh (cửa sổ riêng thu nhỏ 390px cho E5), Marcus, Dave, Priya.
- Màn hình 1920x1080, zoom trình duyệt 100%. Ẩn thanh demo bằng phím H trước khi bấm quay. Tắt thông báo hệ thống.
- Lúc nào bấm gì:
  - Trước beat 7: `curl -X POST localhost:8000/api/v1/demo/logs/inject`. Agent gặp dòng này ở lần `read_logs` kế tiếp, nên gọi trước khi Atlas chạy tới đó (khoảng beat 6).
  - Beat 14: `curl -X POST localhost:8000/api/v1/demo/requests/CR-0192/expire`.
- Chạy thử trọn vòng một lần, rồi reset lại ngay trước khi quay thật.
- Ghi âm lời thoại riêng hoặc đọc trực tiếp; giữ im lặng ở beat 3 khi step hiện dần.

## Xuất mp4 dưới 100MB

Quay bằng QuickTime hoặc OBS, rồi:

```bash
ffmpeg -i raw.mov -vf "scale=1920:1080,fps=30" -c:v libx264 -crf 26 -preset slow \
  -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart demo/cosign-demo.mp4
ls -lh demo/cosign-demo.mp4
```

Video 2 phút ở CRF 26 thường 20-60MB. Nếu vượt 100MB, tăng CRF lên 28-30 hoặc hạ xuống 1280x720. Xem lại toàn bộ file trước khi commit.
