# Cosign — tài liệu màn hình cho dev (Next.js)

Viết cho người code. Design system (palette, type, mô tả visual của từng component) xem `docs/planning/COSIGN-SCREENS.md` §1, không chép lại ở đây. Contract API/WS xem `docs/API.md`; file mock ở `docs/mocks/`. Mỗi màn dưới đây ghi: route, role, component, nguồn data, hành động → API/WS, trạng thái, và chỗ gọi TideCloak SDK thật.

---

## 1. Quy ước chung

### 1.1 Khung dự án

- Khởi tạo từ `npm init @tidecloak/nextjs@latest` (App Router). Giữ nguyên cấu hình TideCloak của scaffold (`tidecloak.json`, provider, middleware) — **CẦN KIỂM CHỨNG** tên file/cấu trúc scaffold sinh ra, chỉnh lại mục này sau khi init.
- Cấu trúc thư mục:
  - `app/(auth)/login` — S1, không có shell.
  - `app/(shell)/...` — mọi màn còn lại, bọc trong `AppShell` (sidebar + top bar).
  - `app/m/requests/[id]` — E5 mobile, shell tối giản (không sidebar).
  - `components/` — component dùng chung (§3).
  - `lib/api.ts` — client REST (`useApi`), đọc `NEXT_PUBLIC_API_MODE`.
  - `lib/socket.ts` — `useCosignSocket(channels)`.
  - `lib/tide.ts` — wrapper mỏng quanh `IAMService` (`getToken`, `hasRealmRole`, `doEncrypt`, `doDecrypt`).
  - `lib/mock/` — loader đọc `docs/mocks/*.json` và replayer cho `docs/mocks/ws/storyboard.json`.
- Mỗi route group theo role có `layout.tsx` guard: lấy `GET /me` (hoặc `hasRealmRole()` từ SDK), sai role thì `redirect(home)` với `home` lấy từ `/me`.

### 1.2 Hai chế độ chạy

| `NEXT_PUBLIC_API_MODE` | REST | WS | Auth | Dùng khi |
|---|---|---|---|---|
| `mock` | đọc `docs/mocks/<file>.json` theo bảng map trong `docs/mocks/README.md`; POST trả file tương ứng và cập nhật state cục bộ | replay `docs/mocks/ws/storyboard.json` theo timestamp (có nút Play/Step ở RoleSwitcher) | không cần TideCloak; identity giả lập bằng header `X-Demo-User` | port màn từ Claude Design, chạy trước khi backend xong |
| `live` | `NEXT_PUBLIC_API_URL` + `/api/v1`, Bearer `getToken()` | `NEXT_PUBLIC_WS_URL`, message `auth{token}` đầu tiên | TideCloak thật | tích hợp, quay video |

Cả hai mode phải render cùng một bộ component; chỉ `lib/api.ts` và `lib/socket.ts` biết mode.

### 1.3 Demo role switcher (top bar)

- Segmented: Atlas · Linh · Marcus · Dave · Priya.
- Mode `mock`: đổi `X-Demo-User` (`ai-oncall-agent`, `linh.tran`, `marcus.lee`, `dave.kim`, `priya.nair`), gọi lại `/me`, điều hướng tới `home` của role.
- Mode `live`: switcher **không đổi identity trong tab**, vì token là của phiên TideCloak. Bấm sẽ mở tab mới `/login?as=<username>` (quick-login tile). Khi quay video dùng 5 tab/5 cửa sổ, mỗi tab đăng nhập một user. Ghi rõ tooltip "Opens a new session" trong live mode.
- Tab Agent Console (A-series) **bắt buộc** đăng nhập `ai-oncall-agent` trong live mode, vì chỉ tab đó nhận `tool_call` và gọi `doDecrypt` với token của agent.

### 1.4 Hooks dùng chung

- `useMe()` → `GET /me` (mock: `me.json`), cache toàn app, expose `user`, `roles`, `authority`, `home`, `contextFlagged`.
- `useApi<T>(path, opts)` → fetch + SWR nhẹ; `mutate` sau POST.
- `useCosignSocket(channels: string[], { console?: boolean })` → mở một kết nối/tab, gửi `auth` rồi `subscribe`, trả `on(type, handler)`, `send(envelope)`, `status`. Reconnect thì caller gọi lại snapshot REST (API.md §6). `console: true` chỉ dùng ở `/agent`.
- `useRequest(id)` → `GET /requests/{id}` + lắng nghe `request.updated` / `request.approved` / `request.denied` / `request.expired` để cập nhật tại chỗ.
- `useRun(runId)` → `GET /agent/runs/{id}` + `agent.step` (upsert theo `step.id`), `agent.message`, `agent.run.status`.

---

## 2. Cây route

```
app/
  (auth)/login                        S1  Sign-in (Tide BYOiD)
  (shell)/
    page.tsx                          S2  Role home redirect (/ → home từ /me)
    agent/                            A1–A5 Agent Console (role agent; human xem read-only)
      runs/[id]/summary               A6  Run summary
    incidents/                        E1  Incidents home (oncall, security, admin, compliance)
      [id]                            E2  War room (tabs Timeline · Agent · Metrics · Access)
    requests/[id]                     E3  Approval review desktop (+ E4 modal)
    governance/                       L1  Governance overview (security)
      requests/[id]                   L2  Change request review (security view)
      policies                        L3  Quorum policies
      agents/                         L4  Agent registry
        [username]                    L4  Agent detail
    admin/
      users                           R1  Users & Roles (+ R2 drawer)
      data                            R3  Data browser (+ compare view)
      data/seed                       Seed page: doEncrypt → POST /records/bulk (chỉ Marcus/Dave)
      audit                           R4  Audit log (attempt to tamper)
    audit/                            C1  Audit trail (compliance, security, admin, oncall)
      receipts/[incident]             C2  Access receipt
  m/requests/[id]                     E5  Mobile approval (390px, không sidebar)
```

Drawer/modal không có route riêng: S3 Notifications (mọi màn shell), E4 Sign modal (E3/E5/L2), R2 Edit roles drawer (R1).

Nav theo role (sidebar lấy từ `/me.roles`):

| Role | Nav |
|---|---|
| `agent` | Console `/agent`, Authority (panel phải của A1), Requests `/agent` (tab) |
| `oncall` | Incidents `/incidents`, Approvals `/incidents` (panel "Needs your approval"), Services (trong E1) |
| `security-lead` | Governance `/governance`, Approvals `/governance`, Agents `/governance/agents`, Policies `/governance/policies` |
| `platform-admin` | Users & Roles `/admin/users`, Data `/admin/data`, Audit `/admin/audit` |
| `compliance` | Audit Trail `/audit`, Access Receipts `/audit/receipts/INC-2417` |

---

## 3. Component dùng chung

Visual spec ở `docs/planning/COSIGN-SCREENS.md` §1. Ở đây chỉ ghi props và nguồn data.

| Component | Props chính | Nguồn data |
|---|---|---|
| `AppShell` | `children`, `nav` (theo role), `collapsed` | `useMe()` |
| `TopBar` | `incident?`, `notificationsCount`, `onOpenNotifications` | `GET /incidents` (active), `GET /notifications` (count unread) |
| `IncidentBanner` | `incident: {id, service, status, started_at}` | `incident.updated` để đổi màu/ẩn khi resolved |
| `RoleSwitcher` | `current`, `mode: "mock"|"live"`, `onSwitch` | §1.3; mock mode thêm nút Play/Step storyboard |
| `NotificationsDrawer` (S3) | `open`, `groups: {approval, agent, security}` | `GET /notifications`, event `notification`, `request.updated` |
| `QuorumSeal` | `approvals`, `required`, `of`, `signedBy: [{username, display_name}]`, `signature?`, `size: "mini"|"md"|"lg"`, `animateLast?` | trường `quorum` của AccessRequest; `signature` khi `request.approved` |
| `TideRefusalCard` | `missingRole`, `note`, `onRequestAccess?` | `step.error` (code `tide_refused`) từ `agent.step` hoặc lỗi `doDecrypt` tại chỗ |
| `RiskTierChip` | `tier`, `escalated?`, `escalationReason?` | `request.tier/escalated/escalation_reason`, `step.tier` |
| `AuthorityMeter` | `items: AuthorityItem[]` (`state: allowed|locked|pending|granted`, `expires_at?`, `reason?`), `compact?` | `/me.authority`, event `authority.updated`, `GET /agents/{u}` |
| `AgentStep` | `step: AgentStep`, `expanded?`, `onToggle` | `useRun()` |
| `InjectionFlag` | `line`, `label`, `score`, `lang` | `injection.detected`, `logs.json` dòng `scan` |
| `CountdownPill` | `expiresAt`, `warnUnderMin=5` | `authority.granted.expires_at`; tự tick client; đổi amber <5 phút; `request.expired` → ẩn |
| `CiphertextBlock` | `ciphertext`, `tag`, `truncate?` | `GET /records`, `GET /admin/data/merchants` |
| `IdentityChip` | `username`, `displayName`, `type: agent|human`, `role?` | mọi object `requester`/`user` |
| `DataTable` | `columns`, `rows`, `renderCell`, `dense?` | R1, R3, L1 queue, A5 |
| `JsonViewer` | `value`, `collapsed?` | step input/output, audit event detail |
| `MetricsChart` / `Sparkline` | `points`, `markers`, `height` | `GET /incidents/{id}/metrics`, `metrics.tick` append |
| `Timeline` | `events: {ts, actor_type, kind, label, outcome}` | `GET /incidents/{id}/timeline`, `audit.appended` |
| `RequestCard` | `request`, `variant: "list"|"detail"|"inline"` | AccessRequest |
| `SafetyChecks` | `checks: [{id,label,status: pass|fail|info, detail?}]`, `collapsed?` | `request.safety_checks` |
| `BlastRadius` | `blast: {customer_records, could[]}` | `request.security_context.blast_radius` |
| `Toast` (provider) | `kind: ok|warn|refused`, `title`, `body` | event `toast`, và lỗi REST |
| `SigningProgress` | `orkDone`, `orkTotal`, `step` | event `signing.progress` |
| `PrincipleFooter` | — | copy cố định: "Reducing authority is instant. Increasing authority requires quorum." (L1, L3, L4, R2) |

Trạng thái chung mọi màn: `loading` (skeleton theo layout), `empty` (copy ngắn + hành động), `error` (banner + Retry; 401 → về `/login`; 403 → card "You don't have the role for this view" + link về home). Các trạng thái riêng ghi ở từng màn.

---

## 4. Màn dùng chung

### S1 — Sign-in (Tide BYOiD)

- Route `/login` (group `(auth)`, không shell). Mọi người vào được; đã đăng nhập thì redirect `home`.
- Component: `SignInCard`, `QuickLoginTiles` (5 tile), info line "Zero-knowledge sign-in · no password is stored on any server."
- Data: không gọi REST trước khi login. Sau login: `GET /me` → `home`.
- Hành động: "Continue with Tide" → **SDK thật**: redirect login của TideCloak scaffold (hàm login của `IAMService` — **CẦN KIỂM CHỨNG** tên hàm trong scaffold). Quick-login tile: live mode → login với `login_hint=<username>` (**CẦN KIỂM CHỨNG** scaffold có pass được hint không; fallback: tile chỉ điền username); mock mode → set `X-Demo-User` rồi đi tới home.
- Trạng thái: `default`; `authenticating` (spinner "Proving identity to Tide network… 14/20 nodes" — animation giả, chạy trong lúc chờ redirect về); `success` (flash xanh rồi redirect); `error` (TideCloak không reachable → banner "Tide network unreachable" + Retry).

### S2 — Role home redirect

- Route `/`. Server component: gọi `/me`, `redirect(home)`. `home` theo role: agent `/agent`, oncall `/incidents`, security-lead `/governance`, platform-admin `/admin/users`, compliance `/audit`. Không có `/me` (401) → `/login`.

### S3 — Notifications drawer

- Mọi màn shell, mở từ chuông ở `TopBar`.
- Component: `NotificationsDrawer`, mỗi item approval dùng `IdentityChip` (hexagon), `RiskTierChip`, `QuorumSeal size="mini"`, nút Review.
- Data: `GET /notifications` (`notifications.json`), nhóm `approval / agent / security`. Event `notification` prepend + tăng count; `request.updated` cập nhật seal mini theo `request_id`.
- Hành động: Review → `/requests/{id}` (oncall) hoặc `/governance/requests/{id}` (security); mở item → `POST /notifications/{id}/read`.
- Trạng thái: empty "No notifications"; count badge ở chuông.

---

## 5. AI Agent — Atlas (A1–A6)

Tất cả A1–A5 là **một trang** `/agent`, khác nhau ở state của run. Role `agent` là chủ; `oncall`/`security-lead` được xem read-only (không có nút Submit, không nhận `tool_call`).

**Tab Agent Console trong live mode:** đăng nhập `ai-oncall-agent`, `useCosignSocket(["run:<id>","incident:INC-2417"], {console: true})`. Nhận `tool_call` thì xử lý đúng API.md §6.4: `GET /records?ids=` → `IAMService.doDecrypt(items.map(r => ({encrypted: r.ciphertext, tags: [r.tag]})))` → gửi `tool_result` (ok hoặc `tide_refused`) → nếu ok thì `POST /records/access-log` và render bảng A5. Đây là chỗ Tide từ chối thật, không phải if/else của app.

### A1 — Agent Console (live run)

- Route `/agent`.
- Layout 3 cột: trái `RunTimeline` (list `AgentStep`), giữa `ConversationStream` (bubble `agent.message` xen `ToolCallBlock` collapsible input/output) với `IncidentHeaderCard` (INC-2417 + `Sparkline`) ở trên, phải `AuthorityPanel` (`IdentityChip` Atlas, `AuthorityMeter`, "Open requests: n").
- Data snapshot: `GET /me` (`me.json`), `GET /incidents/INC-2417` (`incident.json`), `GET /incidents/INC-2417/metrics` (`incident-metrics.json`), `GET /agent/runs?incident=INC-2417` rồi `GET /agent/runs/{id}` (`agent-run.json`). Event: `agent.step`, `agent.message`, `agent.run.status`, `authority.updated`, `toast`, `metrics.tick`, `tool_call`.
- Hành động: nếu chưa có run → nút "Start run" → `POST /agent/runs {incident_id:"INC-2417"}` (`agent-run-create.json`). Click step → expand. Human xem: "Pause agent" → `POST /agent/runs/{id}/pause` (chỉ oncall/security).
- Trạng thái run (header dot): `running` (pulsing purple "Atlas is working"), `waiting_approval` ("Waiting for human approval" + link request), `paused` (kill switch, banner xám), `completed` (CTA "View summary" → A6), `failed`. Trang: `loading`; `empty` (không run → Start run); `error`; WS mất kết nối → chip "Reconnecting…" rồi gọi lại snapshot.

### A2 — Rollback executed (T0)

- Cùng `/agent`; step `rollback` expanded: input `{deploy:"v412"}`, output "Rolled back in 41s", `RiskTierChip T0` + note "auto-approved by policy", `MetricsChart` với marker "rollback".
- Data: `agent.step` (st_04, `tier:"T0"`), `toast` kind ok "Low-risk action executed. Logged & signed.", `metrics.tick`.
- Không có hành động người dùng.

### A3 — Decryption refused → request access

- Cùng `/agent`. Step `decrypt_records` status `refused` → render `TideRefusalCard` inline (`missing_role` từ `step.error`).
- Dưới card: `RequestForm` inline, pre-filled từ step `request_access.input` (capability, scope 5 ids mono, duration 15, justification, evidence links), `RiskTierChip T2` + eligible (Linh, Marcus, Dave). Với role `agent` ở `AGENT_MODE=llm` agent tự submit qua tool, form chỉ hiển thị (read-only); nút "Submit request" (purple) chỉ bật khi step `request_access` chưa có — bấm thì `POST /requests` body như API.md §5.4 (`request-create.json`).
- SDK thật: lỗi refused đến từ `doDecrypt` trong xử lý `tool_call` (mục đầu §5). Mock mode: replay `tool_result ok:false` từ storyboard.
- Sau submit: event `request.created` → `AuthorityMeter` hàng `customer_pii.selfdecrypt` → `pending` với `QuorumSeal mini 0/2`; `agent.message` "Waiting for human approval…"; `agent.run.status = waiting_approval`.
- Trạng thái: `refused` (card đỏ), `submitting`, `pending` (seal 0/2 → 1/2 theo `request.updated`), `denied` (`request.denied` → card xám "Denied by <by>: <reason>").

### A4 — Prompt injection encountered

- Cùng `/agent`. Event `injection.detected` → trong `ConversationStream` chèn `LogExcerptBlock` với dòng flagged bằng `InjectionFlag` ("PROMPT_INJECTION · 0.97 · fr"); `AuthorityPanel` thêm banner amber "Atlas context contains suspected injection — all requests escalated one tier." với nút "Quarantine context" (chỉ security-lead) → `POST /agent/runs/{id}/quarantine`.
- Step `grant_role` status `blocked` → `BlockedResultCard`: "Role change requires quorum", "Change request CR-0193 created · status: pending", `RiskTierChip T3 escalated` ("↑ +1 tier: injection detected in agent context"), note "Agents can never approve their own requests."
- Data: `agent.step` (tool `grant_role`, `status:"blocked"`, `output.request_id`), `request.created` CR-0193 (flags `injection`, `security_review`), `agent.message` guardrail.
- Trigger trong demo: presenter gọi `POST /demo/logs/inject` (nút ẩn trong RoleSwitcher, chỉ hiện khi `NEXT_PUBLIC_DEMO_CONTROLS=1`). Mock mode: storyboard replay.
- Trạng thái: `flagged` (banner amber), `quarantined` (banner chuyển xám "Context quarantined by Marcus Lee").

### A5 — Access granted (time-boxed)

- Cùng `/agent`. Event `request.approved` → `toast` "Access granted · threshold-signed by Linh Tran & Marcus Lee"; `authority.updated` → hàng `customer_pii.selfdecrypt` state `granted` + `CountdownPill expiresAt`.
- `authority.updated.token_refresh_required=true` → tab Agent Console phải làm mới token để có role mới: **CẦN KIỂM CHỨNG** SDK có `updateToken()` không; fallback `window.location.reload()` (silent SSO), sau reload gọi lại snapshot và subscribe `console:true`.
- Agent loop gửi `tool_call decrypt_records` lần 2 → **SDK thật `doDecrypt`** thành công → `tool_result ok:true` → render `DecryptedRecordsTable` (5 hàng: merchant id, name, settlement bank, payout currency, last 3 tx status; cột anomaly highlight "payout currency changed EUR→VND by config in v413"), dòng nhỏ "Decrypted in this session only · not visible to server or other users". Plaintext chỉ nằm trong state của tab này.
- Rồi `POST /records/access-log {run_id, record_ids, fields}`; `agent.message` diagnosis + "Patch merchant config migration; request T1 deploy".
- Trạng thái: `granted` (countdown xanh → amber <5 phút), `decrypting` (spinner trên bảng), `decrypt_error` (`TideRefusalCard` lại nếu token chưa refresh — kèm nút "Refresh session"), `expired` (`request.expired` → bảng mờ đi + overlay "Access expired · plaintext cleared", xoá state plaintext).

### A6 — Run summary

- Route `/agent/runs/[id]/summary`. Role `agent`, `oncall`, `security-lead`, `compliance`.
- Component: `SummaryCard` (Resolved 03:31 · MTTR 19 min · Actions 7: 5 auto, 2 approved, 1 blocked), `AuthorityReturnedList` (`customer_pii.selfdecrypt` revoked 03:28 expired ✓), nút "View access receipt" → `/audit/receipts/INC-2417`.
- Data: `GET /agent/runs/{id}/summary` (`agent-run-summary.json`). Event `request.expired` cập nhật list nếu đang mở sớm.
- Trạng thái: run chưa `completed` → banner "Run still in progress" + số liệu tạm.

---

## 6. On-call SRE — Linh (E1–E5)

Role `oncall` (security-lead và platform-admin cũng vào được E1–E3).

### E1 — Incidents home

- Route `/incidents`.
- Component: `StatCards` (Active incidents, Agent runs today, Pending approvals pulsing amber, MTTR 7d), `ActiveIncidentCard` (INC-2417, mini timeline, CTA "Open war room"), panel phải `NeedsApprovalList` (`RequestCard variant="list"` + `QuorumSeal mini`), `ServicesHealthList`.
- Data: `GET /incidents` (`incidents.json`: `stats` + `items`), `GET /requests?status=pending` (`requests.json` lọc pending, bỏ request của chính mình), `GET /services` (`services.json`). Event: `incident.updated`, `request.created/updated/approved/expired`, `notification`.
- Hành động: Open war room → `/incidents/INC-2417`; Review → `/requests/{id}`.
- Trạng thái: empty incidents ("All quiet"), empty approvals ("Nothing waiting for you"), services loading skeleton.

### E2 — War room (incident detail)

- Route `/incidents/[id]`, tabs `?tab=timeline|agent|metrics|access`.
- Component: `IncidentHeader` (SEV-1, status, elapsed timer client-side từ `started_at`), `Timeline` (human xanh, agent tím, approval seal xanh lá, refusal đỏ), `MetricsChart` với markers, `AgentDrawer` (compact A1: `useRun()`, nút "Pause agent"), `AccessList` (request trong incident).
- Data: `GET /incidents/{id}` (`incident.json`), `/timeline` (`incident-timeline.json`), `/metrics` (`incident-metrics.json`), `/access` (`incident-access.json`), `GET /agent/runs?incident=` (`agent-runs.json`). Event: `agent.step`, `agent.run.status`, `metrics.tick`, `request.*`, `audit.appended` (append vào timeline), `incident.updated`.
- Hành động: Pause agent → `POST /agent/runs/{id}/pause`; Resume → `/resume`; click request → `/requests/{id}`.
- Trạng thái: incident `resolved` → header xanh, timer dừng; run `paused` → drawer banner; tab Access empty "No access requests in this incident".

### E3 — Approval request review (desktop)

- Route `/requests/[id]`. Role trong `quorum.eligible` xem được nút quyết định; role khác (compliance) xem read-only; requester thấy "You cannot approve your own request".
- Component trái: `RequestCard variant="detail"` (requester `IdentityChip`, capability mono, scope list, duration, justification quote, evidence `MetricsChart` mini + log excerpt). Phải `DecisionPanel`: `QuorumSeal size="lg"`, eligible list, `RiskTierChip`, `SafetyChecks`, nút "Approve & sign" (primary), "Deny" (ghost red), dropdown "Approve with shorter duration" (5/10/15 phút).
- Data: `useRequest(id)` → `GET /requests/{id}` (`request.json`); event `request.updated`, `request.approved`, `request.denied`, `request.expired`.
- Hành động: Approve & sign → mở E4 → `POST /requests/{id}/approve` (body `{duration_min?}`) (`request-approve.json` lần 1, `request-approve-2.json` lần 2). Deny → modal lý do → `POST /requests/{id}/deny {reason}` (`request-deny.json`).
- Trạng thái: `default`; `signing` (E4 modal); `approved 1/2` ("Waiting for 1 more approver", nút Approve disabled cho người đã ký); `complete 2/2` (seal xanh + "Threshold-signed" + hash, nút ẩn); `denied`; `expired`; `withdrawn`; lỗi 403 `requester_cannot_approve` → copy tương ứng; 409 → "Already decided" + reload.

### E4 — Sign approval (modal)

- Modal trên E3/E5/L2. Component `SignModal`: summary line, step indicator Verify identity → Sign → Submit to quorum, `SigningProgress`.
- Luồng mock/`GOVERNANCE_MODE=mock`: gọi `POST /requests/{id}/approve`, trong lúc chờ nghe `signing.progress` (5 tick "Collecting threshold signature… 14 / 20 ORK nodes"); response về → `QuorumSeal animateLast` fill segment với avatar người ký, "1 of 2 approvals".
- Luồng `GOVERNANCE_MODE=real`: **CẦN KIỂM CHỨNG** — nếu TideCloak không có API approve, modal mở popup admin console TideCloak đúng change request (URL lấy từ `request.tide_cr_id`), người dùng ký ở đó, modal poll `GET /requests/{id}` mỗi 2s tới khi `quorum.approvals` tăng. Thiết kế modal có slot "Open Tide console" để cắm.
- Trạng thái: `verifying`, `signing` (progress), `success` (seal animate), `error` (503 `tide_unavailable` → "Tide network unreachable" + Retry).

### E5 — Mobile approval (390px)

- Route `/m/requests/[id]`, layout riêng không sidebar, không top bar đầy đủ (chỉ logo + identity). Role như E3.
- Component: `MobileRequestCard` (capability, scope count, duration, `QuorumSeal md`, `SafetyChecks collapsed`), nút "Approve & sign" cố định đáy (thumb zone), "Deny" text link; `PushNotificationMock` (chỉ render khi `?demo=push` để quay cảnh lock screen).
- Data/hành động: giống E3; E4 modal full-screen.
- Trạng thái: `success` full-screen seal xanh "Signed · 1 of 2"; còn lại như E3. Test ở viewport 390×844.

---

## 7. Security Lead — Marcus (L1–L4)

Role `security-lead`; L1/L3 cho `platform-admin` và `compliance` xem read-only.

### L1 — Governance overview

- Route `/governance`.
- Component: `StatStrip` (Pending change requests, Agents with elevated access now, Injection detections 24h, Policy version v7 signed), `ChangeRequestQueue` (`DataTable`: ID, requester chip, change, `RiskTierChip`, `QuorumSeal mini`, age, status; row flagged đỏ nếu `flags` có `injection`/`self_grant`, hiện `flag_note`), `AuthorityMap` (grid identities × capabilities, ô `✓ ⏳ 🔒 ⏱`), `PrincipleFooter`.
- Data: `GET /governance/overview` (`governance-overview.json`), `GET /governance/authority-map` (`authority-map.json`). Event: `request.*` (cập nhật row/age), `injection.detected` (tăng stat), `authority.updated` (cập nhật ô).
- Hành động: click row → `/governance/requests/{id}`.
- Trạng thái: queue empty "No pending change requests"; `age_s` tick client-side.

### L2 — Change request review (security view)

- Route `/governance/requests/[id]`. Role `security-lead`.
- Component: như E3 + `WhyFlaggedBox` (`security_context.why_flagged` + dòng log với `InjectionFlag`), `BlastRadius`, với CR-0194 thêm `RecentActivityList` (`security_context.recent_activity`) và note "Requester cannot approve own request". Nút: "Deny", "Deny & quarantine agent context", "Approve & sign" (style disabled-looking nhưng bấm được, tooltip "Requires 3 of 3").
- Data: `useRequest(id)` (`request.json` biến thể CR-0193/CR-0194 trong `requests.json`).
- Hành động: Deny → `POST /requests/{id}/deny {reason}`; Deny & quarantine → `POST /requests/{id}/deny {reason, quarantine_agent_context:true}`; Approve & sign → E4.
- Trạng thái: như E3; thêm `quarantined` (badge trên WhyFlaggedBox).

### L3 — Quorum policies

- Route `/governance/policies`.
- Component: `TierTable` (Tier · Example actions · Approvers required · Max duration · Eligible), `EscalationRulesList`, `PolicyVersionHistory` (v7 signed by Marcus, Linh, Dave + hash), nút Edit → `PolicyDraftEditor` với banner "Policy changes are themselves T3 — requires 3 of 3 signatures.", `PrincipleFooter`.
- Data: `GET /policies` (`policies.json`), `GET /policies/versions` (`policy-versions.json`).
- Hành động: Save draft → `POST /policies/draft` (body policy mới) → 202 `quorum_required` → hiện `RequestCard inline` với seal 0/3; event `request.created` (type `policy_change`).
- Trạng thái: `viewing`, `drafting`, `draft_submitted` (0/3), lỗi 403 nếu không phải security-lead.

### L4 — Agent registry

- Route `/governance/agents` và `/governance/agents/[username]`.
- Component: `AgentCard` (identity, model, `AuthorityMeter compact`, runs today, last action, flags) cho Atlas / Ledger-bot / Docs-agent; detail tabs Authority · Runs · Requests · Injection events; `KillSwitchButton` đỏ "Revoke all elevated access" với copy "Reducing authority is instant." + confirm inline (không dùng `confirm()`).
- Data: `GET /agents` (`agents.json`), `GET /agents/{username}` (`agent-detail.json`). Event: `authority.updated`, `agent.run.status`, `injection.detected`.
- Hành động: Kill switch → `POST /agents/{username}/revoke-all` (`agent-revoke-all.json`) → toast "Revoked: …", run → `paused`.
- Trạng thái: agent `idle`/`running`/`paused`; revoke đang chạy (spinner trên nút); empty injection events.

---

## 8. Platform Admin — Dave (R1–R4)

Role `platform-admin` (security-lead xem R1/R3). Trông như admin console bình thường để cú từ chối "ăn" hơn.

### R1 — Users & Roles

- Route `/admin/users`.
- Component: `DataTable` IAM (user, type human/agent, role chips, last login, nút "Edit roles").
- Data: `GET /admin/users` (`admin-users.json`).
- Hành động: Edit roles → mở R2 drawer.
- Trạng thái: loading skeleton 5 hàng.

### R2 — Edit roles → change request, not a change

- Drawer trên R1. Component `EditRolesDrawer` (danh sách role tick được; Dave tick `realm-admin` và `_tide_customer_pii.selfdecrypt`), nút Save; sau Save thay bằng `QuorumRequiredCard` amber: "This is now Change Request CR-0195 · pending quorum (0 / 3). Your approval is not counted on your own request.", `QuorumSeal 0/3`, eligible list, nút "Withdraw request"; `PrincipleFooter`.
- Hành động: Save → `PUT /admin/users/ai-oncall-agent/roles {add:[…], remove:[]}` → **luôn 202** (`admin-roles-put.json`) → toast "No roles changed. TideCloak cannot apply role changes without threshold signatures." Withdraw → `POST /requests/{id}/withdraw`. Bỏ tick role (remove) → có thể 200 ngay (reducing is instant — CẦN KIỂM CHỨNG trong API.md §5.7), toast "Role removed".
- Event: `request.created` (để L1/E1 thấy ngay).
- Trạng thái: `editing`, `saving`, `quorum_required` (card amber), `withdrawn`, lỗi 403.

### R3 — Data browser

- Route `/admin/data`.
- Component: `InfoBar` "You have infrastructure access, not data authority. Encrypted with tag `customer_pii`.", `DataTable` `merchants` (id, name, bank_account, tax_id — cột nhạy cảm là `CiphertextBlock`), nút "Export table" → `ExportModal` ("Export contains 48,201 encrypted rows. Keys are not held by Northwind, the server, or Tide."), toggle **"Compare views"** → `CompareViewPanel` 3 cột: Dave (ciphertext) | Atlas during granted window (plaintext, viền tím) | Linh without role (ciphertext).
- Data: `GET /admin/data/merchants?limit=` (`admin-merchants.json`), `POST /admin/data/merchants/export` (`admin-export.json`), `GET /records?ids=` (`records.json`) cho compare view.
- SDK thật ở compare view: cột "current session" gọi `IAMService.doDecrypt` với token của tab hiện tại. Dave/Linh → lỗi → hiện `CiphertextBlock` + chip "refused by Tide". Cột Atlas trong video là tab Agent Console thật (hoặc ảnh chụp A5 nếu quay riêng); mock mode điền plaintext từ `tool_result` trong storyboard. Ghi rõ trong UI cột nào là live decrypt của phiên này.
- Trạng thái: `loading`, `exporting` → modal, `compare` (3 cột, mỗi cột `decrypting`/`refused`/`plaintext`).

### R4 — Audit log (attempt to tamper)

- Route `/admin/audit`. Dùng lại component C1 (`AuditList`) với thêm row menu "Delete event".
- Data: `GET /audit` (`audit.json`), event `audit.appended`.
- Hành động: Delete event → `DELETE /admin/audit/{id}` → **luôn 403** (`admin-audit-delete.json`) → `RefusedModal` "Audit events are threshold-signed. Deletion requires T3 quorum and is itself recorded." (hiện `request_id` CR-0196 nếu có); ngay sau đó `audit.appended` thêm sự kiện `admin.audit.delete blocked` lên đầu list.
- Trạng thái: `refused` modal; list loading.

### Seed page — `/admin/data/seed` (không trong storyboard)

- Role `security-lead` hoặc `platform-admin` **có** `_tide_customer_pii.selfencrypt` (seed: Marcus). Không có role → card 403.
- Component: `SeedPanel`: hiện 5 bản ghi plaintext mẫu (từ API.md §5.5) dạng JSON editor, nút "Encrypt & upload".
- Hành động: **SDK thật** `IAMService.doEncrypt(records.map(r => ({data: JSON.stringify(r), tags: ["customer_pii"]})))` → `POST /records/bulk {items:[{id, tag:"customer_pii", ciphertext}]}` → toast số bản ghi. Nút "Verify" gọi `GET /records?ids=` rồi `doDecrypt` lại để chắc round-trip. Mock mode: nút disabled, note "Seed only in live mode".
- Trạng thái: `encrypting`, `uploading`, `done`, `error` (SDK ném lỗi → hiện raw message, CẦN KIỂM CHỨNG format).

---

## 9. Compliance — Priya (C1–C2)

Role `compliance`; `security-lead`, `platform-admin`, `oncall` xem được.

### C1 — Audit trail

- Route `/audit`, filter trong query string (`actor_type`, `incident`, `capability`, `outcome`, `from`, `to`).
- Component: `AuditFilterBar`, `AuditList` (dense, mono timestamps, icon theo actor type, outcome chip, "verified ✓" hover hiện signers + hash), `ChainHighlight` cho INC-2417 (nhóm 10 sự kiện theo thứ tự ở API.md §5.9), panel phải `AuditDetail` (`JsonViewer`, signature details, nút "Verify again").
- Data: `GET /audit?…&limit=&cursor=` (`audit.json`), `GET /audit/{id}` (`audit-event.json`), `POST /audit/{id}/verify` (`audit-verify.json`). Event `audit.appended` prepend nếu khớp filter.
- Hành động: chọn row → panel detail; Verify again → POST verify → badge "Verified · 14/20 ORK" hoặc đỏ "Verification failed".
- Trạng thái: `loading`, `empty` ("No events match"), `verifying`, cursor "Load more".

### C2 — Access receipt

- Route `/audit/receipts/[incident]`.
- Component: `ReceiptCard` in được (CSS print): Summary, Approvals (`QuorumSeal` + tên + giờ), Data accessed (5 ids, fields, "11m32s"), Blocked attempts (2), Signatures (hash list), footer "Generated from threshold-signed audit events. No single party could have altered this record." Nút "Export PDF" (→ `window.print()`; lưu ý artifact sandbox không in được, app thật thì được), "Share with auditor" (copy link).
- Data: `GET /incidents/{id}/receipt` (`receipt.json`).
- Trạng thái: incident chưa resolved → banner "Incident still open · receipt is partial"; 404 → "No receipt for this incident".

---

## 10. Ưu tiên build và map sang issue

| Ưu tiên | Màn | Issue nhóm màn |
|---|---|---|
| Must | S1, S2, S3 | web: shell + S1/S2/S3 |
| Must | A1, A3, A4, A5 | web: A1–A6 Agent Console |
| Must | E3, E4 | web: E1–E5 |
| Must | R2, R3 (compare view) | web: R1–R4 |
| Must | C2 | web: C1–C2 |
| Nice | A2, A6 | web: A1–A6 Agent Console |
| Nice | E1, E2, E5 | web: E1–E5 |
| Nice | L1, L3 | web: L1–L4 |
| Nice | R1, seed page | web: R1–R4 |
| Skip nếu thiếu giờ | L2 (gộp vào E3 + WhyFlaggedBox), L4, R4, C1 full filters | tương ứng |

Thứ tự làm: shell + mock loader + `useCosignSocket` trước (mọi màn cần), rồi A-series (trọng tâm video), rồi E3/E4, R2/R3, C2. A-series phải chạy được trong mock mode bằng storyboard replay trước khi backend có WS.

---

## 11. Port từ Claude Design

- Lấy code prototype theo từng role section; tách mỗi màn thành một `page.tsx` + các component vào `components/`. Component xuất hiện ≥2 màn (bảng §3) chỉ giữ một bản.
- Thay data tĩnh trong prototype bằng `useApi`/`useRun`/`useRequest`/`useCosignSocket`; giữ shape đúng theo `docs/openapi.yaml` (sinh type bằng `openapi-typescript` vào `lib/types.ts`).
- Giữ nguyên token màu/typography từ prototype (map sang CSS variables `--bg`, `--surface`, `--accent`, `--ok`, `--pending`, `--refused`, `--agent`), dark mặc định, light variant bằng `data-theme`.
- Mọi copy UI giữ tiếng Anh y như COSIGN-SCREENS.md (copy là một phần của câu chuyện video).
- Role switcher của prototype (đổi state cục bộ) → `RoleSwitcher` theo §1.3; trong live mode không được giả lập identity.
- Loại bỏ mọi `alert/confirm/prompt`; confirm inline.
- E5: test ở 390×844, nút Approve cố định đáy, seal không tràn; E3 desktop phải không vỡ ở 1280.
- Mỗi màn port xong phải chạy được ở `NEXT_PUBLIC_API_MODE=mock` với file mock tương ứng, rồi mới nối live.
