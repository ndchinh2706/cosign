# Cosign — bối cảnh cho agent

Prototype cho Challenge 2 "UNLOCKED" (RMIT hackathon × Tide). Cosign cho AI agent quyền vào production mà không có god key: việc rủi ro thấp agent tự làm; việc rủi ro cao (giải mã dữ liệu khách, đổi role, xoay secret) cần quorum người duyệt, do TideCloak cưỡng chế bằng mật mã. Hạn nộp 18:00 22/10/2026.

## Đọc trước khi làm một issue
- Issue đang làm: mục Context ghi file cần đọc, owner, reviewer, branch.
- `docs/BOARD.md`: phân công, quy ước branch/PR/label, lịch sync.
- `docs/API.md` + `docs/openapi.yaml` + `docs/mocks/`: contract REST `/api/v1` và WS `/ws`. Đây là nguồn chuẩn; đổi contract phải sửa cả ba trong cùng PR.
- `docs/SCREENS.md`: route, component, data, trạng thái của 23 màn. Visual gốc ở `design/prototype/` (mở `Cosign.dc.html`), design system ở `docs/planning/COSIGN-SCREENS.md` §1.

## Bố cục
- `api/`: FastAPI. `web/`: Next.js App Router + TideCloak SDK. `docker-compose.yml`: tidecloak + api + web.
- Mode qua env: `AUTH_MODE`, `GOVERNANCE_MODE`, `AGENT_MODE`, `SCAN_MODE` (backend), `NEXT_PUBLIC_API_MODE`, `NEXT_PUBLIC_TIDE_MODE` (frontend). Xem `.env.example`.

## Luật bất biến
- Giải mã chỉ ở trình duyệt (`IAMService.doDecrypt`). Backend chỉ lưu ciphertext, không bao giờ có khoá hay plaintext trong DB.
- Agent không bao giờ tự duyệt request của chính nó; tăng quyền luôn qua quorum, giảm quyền thì tức thì.
- Không bịa API TideCloak ngoài những gì có trong `docs/API.md`; chỗ chưa chắc ghi `CẦN KIỂM CHỨNG`.
- Không commit secret. `ANTHROPIC_API_KEY` chỉ trong `.env` local hoặc GitHub secret.

## Cách làm việc
- Một issue một branch (tên ghi trong issue), PR nhỏ, body `Closes #n`, label `status:review`.
- Trước khi mở PR: backend chạy `pytest`; frontend chạy `npm run build`.
- Tài liệu viết tiếng Việt, identifier và copy giao diện tiếng Anh. Không dùng checkbox markdown.
