# docs/mocks — mock response cho frontend

Mỗi file là **body response** của một endpoint trong `docs/API.md` §5 (không bọc thêm). Dữ liệu dùng đúng sample của `docs/planning/COSIGN-SCREENS.md` §10 (Northwind Pay, INC-2417, run_01, CR-0192…CR-0195, 5 merchant `mrc_*`). Sinh bởi một script duy nhất nên các ID, timestamp, hash chain nhất quán giữa các file.

## Cách frontend dùng

- `NEXT_PUBLIC_API_MODE=mock`: client `useApi()` map `method + path` → file trong thư mục này (bảng dưới) thay vì gọi FastAPI. Trạng thái mặc định của mock là lúc **03:15** (CR-0192 pending 0/2, chưa có injection). Các biến thể theo thời gian (approve lần 1/2, deny) có file riêng.
- WS ở mock mode: `useCosignSocket()` replay `ws/storyboard.json` theo thứ tự mảng (có trường `beat` để nhảy theo storyboard video), hoặc nạp từng file `ws/server.<event>.json` để test một event. `ws/client.*.json` là mẫu message client gửi lên.
- `records-plaintext-demo-only.json` chỉ để render bảng A5 ở mock mode. Ở live mode plaintext chỉ có sau `IAMService.doDecrypt` trong tab trình duyệt; FastAPI không bao giờ trả file này.
- Ciphertext trong `records.json` / `admin-merchants.json` là chuỗi giả có prefix `MOCK-CIPHERTEXT-`; live mode thay bằng output thật của `IAMService.doEncrypt`.

## File ↔ endpoint

| File | Endpoint |
|---|---|
| `health.json` | `GET /health` |
| `me.json` | `GET /me` (user `ai-oncall-agent`) |
| `notifications.json` | `GET /notifications` |
| `incidents.json` | `GET /incidents` |
| `incident.json` | `GET /incidents/INC-2417` |
| `incident-timeline.json` | `GET /incidents/INC-2417/timeline` |
| `incident-metrics.json` | `GET /incidents/INC-2417/metrics` |
| `incident-access.json` | `GET /incidents/INC-2417/access` |
| `receipt.json` | `GET /incidents/INC-2417/receipt` |
| `services.json` | `GET /services` |
| `deploys.json` | `GET /deploys?service=payments-api` |
| `logs.json` | `GET /logs?service=payments-api&since=03:00` (dòng id 125 là inject) |
| `agent-run-create.json` | `POST /agent/runs` → 201 |
| `agent-runs.json` | `GET /agent/runs` |
| `agent-run.json` | `GET /agent/runs/run_01` (8 step đầu, trạng thái waiting_approval) |
| `agent-run-summary.json` | `GET /agent/runs/run_01/summary` |
| `request-create.json` | `POST /requests` → 201 |
| `requests.json` | `GET /requests` (CR-0192, 0193, 0194, 0195) |
| `request.json` | `GET /requests/CR-0192` |
| `request-approve.json` | `POST /requests/CR-0192/approve` lần 1 (Linh, 1/2) |
| `request-approve-2.json` | `POST /requests/CR-0192/approve` lần 2 (Marcus, approved, expires_at) |
| `request-deny.json` | `POST /requests/CR-0193/deny` (quarantine) |
| `records.json` | `GET /records?ids=mrc_8812,…` (ciphertext) |
| `records-plaintext-demo-only.json` | không có endpoint; chỉ mock mode |
| `scan.json` | `POST /scan` (dòng inject tiếng Pháp) |
| `admin-users.json` | `GET /admin/users` |
| `admin-roles-put.json` | `PUT /admin/users/ai-oncall-agent/roles` → 202 quorum_required (CR-0195) |
| `admin-merchants.json` | `GET /admin/data/merchants?limit=5` |
| `admin-export.json` | `POST /admin/data/merchants/export` |
| `admin-audit-delete.json` | `DELETE /admin/audit/{id}` → 403 tide_refused |
| `governance-overview.json` | `GET /governance/overview` |
| `authority-map.json` | `GET /governance/authority-map` |
| `policies.json` | `GET /policies` |
| `policy-versions.json` | `GET /policies/versions` |
| `agents.json` | `GET /agents` |
| `agent-detail.json` | `GET /agents/ai-oncall-agent` |
| `agent-revoke-all.json` | `POST /agents/ai-oncall-agent/revoke-all` |
| `audit.json` | `GET /audit?incident=INC-2417` (10 sự kiện, hash chain) |
| `audit-event.json` | `GET /audit/ae_0007` |
| `audit-verify.json` | `POST /audit/ae_0007/verify` |

## WS (`ws/`)

- `server.<type>.json`: một file mỗi event server→client trong API.md §6.3 (`auth_ok`, `error`, `pong`, `tool_call`, `agent.step`, `agent.message`, `agent.run.status`, `injection.detected`, `request.created/updated/approved/denied/expired`, `authority.updated`, `audit.appended`, `incident.updated`, `metrics.tick`, `notification`, `toast`, `signing.progress`).
- `client.<type>.json`: `auth`, `auth-dev`, `subscribe`, `unsubscribe`, `ping`, `tool_result-ok`, `tool_result-refused`.
- `storyboard.json`: mảng ~60 event theo thứ tự **video** (beat 1→6). Timestamp không đơn điệu giữa các beat (injection 03:18 và rogue admin 03:20 được chiếu trước approval 03:15–03:16) vì theo storyboard chứ không theo đồng hồ. Replay theo index mảng, không sort theo `ts`.

Sinh lại toàn bộ: script `gen_mocks.py` (giữ trong scratchpad của người tạo; nếu cần sửa hàng loạt thì chép script vào `scripts/` của repo).
