# Spike #1: change request và quorum của TideCloak

Ngày chạy: 22/10/2026. Image `tideorg/tidecloak-dev:latest` (Keycloak 26.7.5, các provider `iga-core`, `keycloak-tide`, `ragnarok`). Chạy local, mật khẩu admin dev tự đặt cho container tạm.

## Kết luận ngắn

- `GOVERNANCE_MODE=mock` cho bản demo và video. Phần change request (CR) của TideCloak có thật và dùng được qua REST, nhưng ngưỡng quorum nhiều admin và chữ ký Tide không kiểm chứng được ở đây vì bước `setUpTideRealm` đòi email đăng ký (xem "Bị chặn").
- Một phát hiện quan trọng cho thiết kế: với realm bật IGA, `POST role-mappings` trả `204` như thành công nhưng role chưa được gán. Nó chỉ tạo CR `GRANT_ROLES` trạng thái `PENDING`. Gỡ role cũng vậy (CR `REVOKE_ROLES`), nên "giảm quyền là tức thì" trong `docs/API.md` không đúng nếu dùng CR thật.
- `RealTideGovernance` khả thi về mặt API (liệt kê, duyệt CR đều có REST). Chỉ cần người dùng xác nhận phần Tide thật (xem "Việc người dùng cần làm").

## Câu 1: chạy được TideCloak dev không

Có, nhưng compose hiện tại lỗi.

- `docker compose up tidecloak` với named volume `tidecloak-data:/opt/keycloak/data/h2` làm container thoát ngay:

```
ERROR ... Log file error: "/opt/keycloak/data/h2/keycloakdb.trace.db",
cause: "java.nio.file.AccessDeniedException: /opt/keycloak/data/h2/keycloakdb.trace.db"
```

  Nguyên nhân: image chạy `uid=1000(keycloak) gid=0`, named volume mới tạo thuộc root. Cần sửa `docker-compose.yml` (bind mount thư mục host ghi được, hoặc bỏ volume cho dev). Spike này không sửa file đó; việc này nên thành issue riêng.
- Bỏ volume, chạy `docker run -p 8080:8080 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=<dev> tideorg/tidecloak-dev:latest`: sau khoảng 25 giây lên (`Keycloak 26.7.5 ... started in 5.029s`, log `tide-console-bootstrap`).
- Bằng chứng: token admin master cấp được (`grant_type=password`, `admin-cli`), `GET /admin/realms` trả danh sách realm, `GET /admin/master/console/` trả `200`. Image có sẵn một realm `myrealm` rỗng.
- `GET /admin/serverinfo` liệt kê provider `iga-attestor: simple, tide`, `admin-realm-restapi-extension: iga, tide-admin, vendorResources, tideAdminResources, ragnarok...`.

## Câu 2: gán role có thành change request không

Có. Không áp dụng ngay.

Cách chạy được mà không cần email: tạo realm `spike`, đặt attribute `iga.attestor=simple` (attestor không dùng Tide), rồi `POST /admin/realms/spike/tide-admin/toggle-iga {"enabled":true}`. Việc này sinh 209 CR `ADOPT_*`, duyệt hết qua `/approve`. Sau đó:

```
POST /admin/realms/spike/users            -> 202 {"status":"PENDING","changeRequestId":"...","actionType":"CREATE_USER"}
POST /admin/realms/spike/users/{id}/role-mappings/realm  [oncall]
  -> 204 (không có body)
GET  /admin/realms/spike/users/{id}/role-mappings/realm
  -> ["default-roles-spike"]            # role CHƯA được gán
GET  /admin/realms/spike/iga/change-requests?status=PENDING
  -> {"id":"37d8ce37-...","actionType":"GRANT_ROLES","status":"PENDING","threshold":1,"authorizationCount":0,
      "rows":[{"ROLE_ID":"...","USER_ID":"..."}],"readyToCommit":false,"requiredApproverRoles":[]}
POST /admin/realms/spike/iga/change-requests/37d8ce37-.../approve  {}
  -> 200 {"mode":"recorded","committed":true,"authCount":1,"threshold":1,"status":"APPROVED"}
GET  .../role-mappings/realm -> ["default-roles-spike","oncall"]   # đã gán sau khi duyệt
```

Endpoint tìm được (đều dưới `/admin/realms/{realm}/`):

- `GET iga/change-requests[?status=PENDING]`: liệt kê.
- `GET iga/change-requests/{id}`: chi tiết (`status`, `actionType`, `rows`, `threshold`, `authorizationCount`, `authorizers[]`, `readyToCommit`, `requiredApproverRoles`, `dependsOn`).
- `POST iga/change-requests/{id}/approve` body `{}`: ghi một phê duyệt, tự commit khi đủ ngưỡng. Duyệt lại CR đã xong trả `409 "Change request is not in PENDING state"`.
- Không tìm thấy `reject`, `cancel`, `DELETE` (đều `404`). `docs/API.md` cần xử lý "từ chối" ở phía FastAPI.
- Thay đổi realm attribute (kể cả `iga.threshold`) cũng bị biến thành CR (`SET_REALM_ATTRIBUTE`), nên không đặt được ngưỡng bằng cách đó.

Lưu ý khi gọi từ FastAPI: phản hồi `204` của role-mappings không chứa id CR. Phải gọi `GET iga/change-requests?status=PENDING` rồi khớp `actionType=GRANT_ROLES`, `entityId=<user id>`, `rows[].ROLE_ID` để lấy `tide_cr_id`.

Ngưỡng: với attestor `simple` luôn `threshold:1` và admin duyệt được ngay (kể cả chính người tạo). Chuỗi trong `iga-core` cho thấy với attestor `tide`, ngưỡng của role `tide-realm-admin` được mã hoá vào policy ký trong enclave và suy ra từ số admin đang giữ role đó ("projected admins", "committed admins justify threshold"). Cảnh báo khi bật IGA: "Fewer than 2 distinct admin holders... provision a second manage-realm admin (or configure iga.approverRole)". Có các khoá cấu hình `iga.approverRole`, `iga.jitApproverRole`, `iga.scopeMode`. Chưa kiểm chứng được "3 admin, ngưỡng 2" trên Tide thật.

## Câu 3: gỡ role có cần quorum không

Có, trong chế độ IGA.

```
DELETE /admin/realms/spike/users/{id}/role-mappings/realm [oncall]  -> 204
GET .../role-mappings/realm -> ["default-roles-spike","oncall"]      # vẫn còn
GET iga/change-requests?status=PENDING -> {"actionType":"REVOKE_ROLES","status":"PENDING","threshold":1}
```

Sau `/approve` role mới biến mất. Hệ quả: nếu `GOVERNANCE_MODE=real`, "giảm quyền tức thì" phải làm ở tầng Cosign (FastAPI ngừng cho agent dùng, và/hoặc phát ngay chính CR revoke rồi tự duyệt nếu tài khoản dịch vụ có quyền approve), không dựa vào TideCloak tự áp dụng. Với ngưỡng 2 thật, revoke cũng chờ đủ chữ ký, trừ khi dùng cơ chế khác (ví dụ vô hiệu hoá user hoặc huỷ session). Cần xác nhận trên realm Tide.

## Câu 4: thuật toán ký JWT và vị trí role `_tide_*`

Chưa kiểm chứng được trên realm Tide.

- Realm `spike` (attestor `simple`, không có Tide) chỉ có khoá `RS256` (JWKS: `RSA-OAEP`, `RS256`). Server hỗ trợ `EdDSA` trong `id_token_signing_alg_values_supported`, nhưng không có bằng chứng realm Tide dùng nó. Giữ `algorithms=["EdDSA","RS256","ES256"]` trong verify như `docs/API.md` đã ghi.
- Vị trí role: `web/init/realm.json` của template khai `_tide_message.selfencrypt` và `_tide_message.selfdecrypt` trong mục `roles.realm` (realm role), và gán cho user/composite ở mục realm. Docs Tide (JS SDK reference) nói roles `_tide_<tag>.selfencrypt|selfdecrypt` được kiểm tra trong "Doken". Từ đó suy ra role nằm ở `realm_access.roles`, nhưng chưa có token thật để xác nhận. Cách an toàn: code đọc cả `realm_access.roles` lẫn `resource_access.*.roles`.

## Câu 5: khai tag/role mã hoá

- Quy tắc tên (release notes TideCloak 0.11.2): `_tide_[tag].<role>`; mã hoá cần `.selfencrypt`, giải mã cần `.selfdecrypt`. Payload gắn nhiều tag thì cần role của mọi tag.
- Template khai thẳng trong `realm.json` (realm role `_tide_message.selfencrypt`, `_tide_message.selfdecrypt`) rồi import khi tạo realm. Với Cosign: thêm `_tide_customer_pii.selfencrypt` và `_tide_customer_pii.selfdecrypt` vào realm.json cùng cách.
- Qua admin REST: `POST /admin/realms/{realm}/roles {"name":"_tide_customer_pii.selfdecrypt"}`; khi IGA bật, việc tạo role cũng ra CR `CREATE_ROLE` (202) cần duyệt. Tên trong `docs/API.md` §1.1 khớp quy tắc này; chưa mở admin console của realm Tide để xem UI khai tag.

## Bị chặn

Realm Tide thật cần `POST /admin/realms/{realm}/vendorResources/setUpTideRealm` với `email=${SUBSCRIPTION_EMAIL}`, `skipLicense=false` (`web/init/tcinit.sh` bước 2), cần ORK/Cybersecurity Fabric và đăng ký license bằng email. Sau đó còn bước enrollment admin trong Tide enclave (người thật, trình duyệt). Theo giới hạn của spike (không dùng email hay tài khoản của người dùng, không tạo tài khoản), dừng tại đây. Hệ quả: chưa có số liệu về ngưỡng quorum Tide, chữ ký, thuật toán JWT thật, vị trí role trong token Tide.

## Khuyến nghị `GOVERNANCE_MODE`

- Quay video và demo: `mock`. Giữ doDecrypt thật nếu realm Tide chạy được.
- `real` chỉ bật nếu người dùng làm xong các bước dưới và kiểm chứng được ngưỡng 2/3.

## `RealTideGovernance` (#15) cần gọi

Auth: token admin (`grant_type=password`, `admin-cli`, realm `master`), làm mới mỗi lần vì sống khoảng 60 giây.

- `propose_role_change`: `POST users/{id}/role-mappings/realm` (add) hoặc `DELETE` (remove) với body `[RoleRepresentation]`; sau đó `GET iga/change-requests?status=PENDING` và khớp `GRANT_ROLES`/`REVOKE_ROLES` + `entityId` + `rows[].ROLE_ID` để lấy `tide_cr_id`. Cần tra id user và id role (`GET users?username=..&exact=true`, `GET roles/{name}`).
- `status`: `GET iga/change-requests/{id}` (`PENDING`, `APPROVED`; chưa thấy giá trị từ chối). Poll mỗi 2 giây.
- `approve`: `POST iga/change-requests/{id}/approve {}`. Với attestor `tide` và ngưỡng >1, mỗi admin phải ký trong enclave/console của Tide; chưa rõ có gọi được bằng token admin của từng người hay không. Không kiểm chứng được.
- `revoke_role`: thực hiện như một CR `REVOKE_ROLES` (không tức thì). Cosign tự chặn agent ở tầng FastAPI cho đến khi CR commit.
- `user_roles`: `GET users/{id}/role-mappings/realm/composite`.
- Không có reject/cancel: từ chối chỉ ghi trong Cosign.

## Việc người dùng cần làm

- Chạy được `setUpTideRealm` bằng email của chính mình (hoặc email dự án) rồi đăng ký admin trong enclave: `SUBSCRIPTION_EMAIL=<email> bash web/init/tcinit.sh` (cần container `tidecloak` lên; dùng `docker run` không volume tới khi sửa compose).
- Sau đó thêm 2 admin nữa, tạo `agent`, gán role, rồi chạy lại các lệnh ở Câu 2 và 3, và `curl` JWKS + giải mã token để chốt thuật toán và `realm_access`.
- Quyết định có sửa `docker-compose.yml` (bind mount hoặc bỏ volume) trong issue riêng.
- Quyết định chấp nhận "gỡ role cũng cần CR" hay đổi sang giải pháp ở tầng FastAPI.
