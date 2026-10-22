# Cosign — board và cách làm việc 2 người

Hạn nộp: **18:00 22/10/2026** (giờ VN). Tài liệu này là board thực tế của ngày hôm nay; trạng thái việc nằm trên GitHub Issues.

## 1. Board

- Issues: https://github.com/ndchinh2706/cosign/issues (28 issue, lọc theo label `area:*`, `priority:*`)
- Milestone "Submission 22/10 18:00": https://github.com/ndchinh2706/cosign/milestone/1 — xem % done ở đây
- Việc của tôi: `gh issue list --assignee @me --milestone "Submission 22/10 18:00"`
- Việc P0 còn mở: `gh issue list -l priority:P0 --state open`

**Kanban: https://github.com/users/ndchinh2706/projects/1** (project "Cosign", đã gắn repo, đủ 28 issue). Cột Status: Todo → In Progress → Blocked → Review → Done.

- Mở project, bấm "+ New view" → Board, nhóm theo Status (GitHub chưa cho tạo view board qua API, làm tay 10 giây).
- Kéo thẻ khi đổi trạng thái; đồng thời giữ label `status:*` cho người xem từ issue list. Issue đóng hoặc PR merge thì GitHub tự chuyển Done.
- Issue mới tạo: thêm vào project bằng ô Projects bên phải issue (hoặc bật Workflows → Auto-add trong settings project).

**Trạng thái lúc 13:40 (hạn mức Claude chạm 99%, tạm dừng tới 15:00):**
- Đã merge: scaffold, #1 spike (PR #31), #7 #8 (PR #33), #9 agent loop (PR #37), #11 #13 (PR #30), #12 (PR #35), prototype mới (PR #29). Backend 68 test pass.
- Đã đóng: #1 #6 #7 #8 #9 #11 #12 #13.
- Backend còn: #10 `/scan`, #14 JWT, #32 volume compose, #2, #4 + #15 (cần Chính chạy `tcinit.sh` bằng email của mình), demo/README #25–#28.
- Frontend (arokepg): #3 #5 #16–#23 chưa có PR.
- 15:02 agent tự chạy lại: spawn #10 và #14 + #32, review PR web/* nếu có, nhắn Telegram.

## 2. Phân công

Đổi phân công lúc 12:00: **arokepg làm frontend, Chính làm backend.**

| Người | GitHub | Mảng | Issues |
|---|---|---|---|
| arokepg | `arokepg` | Next.js, port màn từ `design/prototype/`, tích hợp SDK TideCloak trên trình duyệt (`doEncrypt`/`doDecrypt`, tool `decrypt_records` ở tab Agent Console), trang seed dữ liệu | #3 #5 #16 #17 #18 #19 #20 #21 #22 #23, chung #24 |
| Chính | `ndchinh2706` | FastAPI, WS hub, agent loop, policy/requests, ciphertext store, audit, `/scan`, mock payments-api, docker-compose, realm TideCloak + spike quorum, README, video, nộp bài | #1 #2 #4 #6–#15 #25 #26 #27 #28, chung #24 |

## 3. Quy ước

- Nhánh: ghi sẵn trong mục Context của từng issue (`web/...` cho arokepg, `api/...` `tide/...` `demo/...` `docs/...` cho Chính), `tide/...` và `docs/...` cho việc chung. Ví dụ `api/8-requests-policy`.
- PR nhỏ, một issue một PR, tiêu đề `#8 Requests + policy engine`. Body ghi `Closes #8`.
- Review chéo: Chính review PR `web/*`, arokepg review PR `api/*`. Review ≤ 10 phút, chỉ chặn khi sai contract hoặc hỏng build. Tự merge nếu reviewer bận quá 20 phút và PR không đụng contract.
- Contract là `docs/API.md` + `docs/openapi.yaml` + `docs/mocks/`. Đổi contract phải sửa cả 3 trong cùng PR và nhắn người kia.
- Frontend code trên mock trước (`NEXT_PUBLIC_API_MODE=mock`), backend trả đúng shape mock. Hai bên không chặn nhau cho tới #23.
- Trạng thái = label: `status:todo` → `status:in-progress` → `status:review` (PR mở) → đóng khi merge; kẹt thì `status:blocked` + comment `BLOCKED: ...` và tag người kia. Xem nhanh: `gh issue list -l status:in-progress`.
- Mỗi issue có mục **Context** (file cần đọc, owner, reviewer, branch), **Sync-up** và **Giao cho agent**.
- Giao việc cho agent: comment `@claude <yêu cầu>` trên issue/PR. GitHub Action `.github/workflows/claude.yml` chạy Claude Code: đọc issue + `CLAUDE.md`, làm trên branch, mở PR. Cần cài một lần (xem §8).
- Commit thẳng `main` chỉ cho docs nhỏ và fix hotfix lúc < 16:30.
- Secrets: `ANTHROPIC_API_KEY` chỉ trong `.env` local, `.env` trong `.gitignore`, repo sẽ public lúc 17:30.

## 4. Sync-up

- 12:30, 14:30, 16:30: gọi 5 phút, mỗi người nói: xong gì, đang làm gì, kẹt gì. Ngoài giờ đó nhắn text.
- 12:30 phải có kết quả spike #1 để chốt `GOVERNANCE_MODE`.
- 16:30 là điểm chốt: nếu E2E #24 chưa chạy, chuyển hẳn sang `GOVERNANCE_MODE=mock` + `AGENT_MODE=scripted` để quay video.

## 5. Lịch theo giờ

| Giờ | Frontend (arokepg) | Backend (Chính) |
|---|---|---|
| 11:30–12:30 | #1 spike quorum (song song #3 scaffold) | #2 compose, #6 skeleton + endpoints đọc |
| 12:30 | Sync 1: chốt governance mode, tên role Tide, alg JWT | |
| 12:30–14:00 | #4 seed realm, #16 client/mock/WS hook, #17 shell | #7 WS hub, #8 requests + policy + mock governance, #11 records |
| 14:00–15:00 | #18 Agent Console, #21 admin R2/R3 | #9 agent loop (scripted trước, llm sau), #13 mock service + demo |
| 14:30 | Sync 2: bật live mode từng màn | |
| 15:00–16:00 | #19 E3/E4/E5, #5 seed data, #23 live mode | #14 JWT, #10 scan, #12 admin/governance/audit, #15 real governance nếu spike ok |
| 16:00–16:30 | #20 L1/L2, #22 C2, #24 E2E cùng nhau | #24 E2E, #27 README draft |
| 16:30 | Sync 3: quyết định quay bằng mode nào | |
| 16:30–17:15 | #25 kịch bản, #26 quay video | fix lỗi E2E, README hoàn thiện |
| 17:15–17:45 | #28 dọn repo, public, nộp form | review README, kiểm video phát được trên GitHub |
| 17:45–18:00 | Dự phòng | Dự phòng |

## 6. Critical path

1. #1 spike quorum → chốt `GOVERNANCE_MODE` (12:30)
2. #3 scaffold + #4 seed realm (Chính) ‖ #6 skeleton + #7 WS + #8 requests (arokepg)
3. #16 client/mock + #17 shell → #18 Agent Console + #21 R2/R3 + #19 E3/E4
4. #9 agent loop với `tool_call`/`tool_result` ‖ #11 records + #5 seed data thật
5. #23 live mode → #24 E2E (16:00–16:30)
6. #26 video (16:30–17:15)
7. #27 README + #28 public + nộp (17:15–17:45)

Việc có thể bỏ nếu thiếu giờ, theo thứ tự bỏ trước: #22 C1 full filters, #20 L3/L4, #19 E1/E2, #10 model C1 (giữ heuristic), #15 real governance (giữ mock), #12 policy versions.

## 7. Rủi ro đã biết

- Quorum change request có thể không gọi được qua API: đã có `MockTideGovernance`, demo vẫn chạy; phần Tide "thật" trong video khi đó là BYOiD login + `doDecrypt` bị từ chối/thành công theo role.
- Tab Agent Console cần token mới sau khi được cấp role; nếu SDK không có refresh thì reload tab tại thời điểm `authority.updated` (cắt cảnh trong video).
- LLM lạc kịch bản khi quay: dùng `AGENT_MODE=scripted`.
- Video > 100MB: `ffmpeg -crf 28`.
- Cập nhật mục này sau #24 với các lỗi còn lại.

## 8. Bật agent khi tag `@claude`

Workflow `.github/workflows/claude.yml` dùng **subscription Claude** (không cần API key) qua secret `CLAUDE_CODE_OAUTH_TOKEN`. Cài một lần (Chính, owner repo):

- Cài Claude GitHub App cho repo `ndchinh2706/cosign`: https://github.com/apps/claude
- Tạo token từ subscription: mở terminal, chạy `claude setup-token`, đăng nhập, copy token.
- Lưu thành secret: `gh secret set CLAUDE_CODE_OAUTH_TOKEN -R ndchinh2706/cosign` rồi dán token khi được hỏi.
- Đã bật và chạy thử thành công lúc 12:15 (issue #10, Action chạy 23 giây). Secret `CLAUDE_CODE_OAUTH_TOKEN` đã set.
- Kiểm tra lại: comment `@claude đọc issue này và tóm tắt việc cần làm` trên một issue, xem tab Actions.
- Lưu ý: mỗi lần agent chạy sẽ trừ vào hạn mức subscription. Khi repo chuyển public lúc 17:30, chỉ collaborator mới kích hoạt được.
