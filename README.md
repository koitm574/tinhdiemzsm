# Tính điểm ZingSpeed Mobile — đăng nhập và duyệt tài khoản

Luồng truy cập: **Đăng ký → xác nhận email → đăng nhập → chờ quản trị viên duyệt → sử dụng**.

Quản trị viên có thể xem danh sách tài khoản, duyệt, khóa, mở khóa và xem nhật ký thay đổi quyền. Thành viên chỉ xem được hồ sơ của chính mình. Tài khoản quản trị không thể bị khóa hay tự cấp quyền qua giao diện.

## Kích hoạt lần đầu

Nhánh này **chưa hoạt động với cấu hình trống**. Hoàn tất các bước dưới đây trước khi đưa lên website đang sử dụng.

1. Tạo một project tại [Supabase](https://supabase.com/dashboard). Giữ mật khẩu cơ sở dữ liệu ở nơi riêng tư.
2. Mở **SQL Editor**, chạy lần lượt toàn bộ hai file:
   - `supabase/migrations/202610160001_access_control.sql`
   - `supabase/migrations/202610160002_protected_scoring.sql`
   Hai migration dành cho project chưa có các bảng `zsm_*`; chỉ áp dụng một lần. Cũng có thể quản lý bằng Supabase CLI và `supabase db push`.
3. Trong cấu hình **Authentication**, bật đăng ký bằng email và xác nhận email. Đặt độ dài mật khẩu tối thiểu là 8. Cấu hình dịch vụ gửi email/SMTP cho website thực tế; kiểm tra gửi được cả email xác nhận và email đặt lại mật khẩu.
4. Đặt **Site URL** và **Redirect URLs** là địa chỉ web của bạn:

   ```text
   https://koitm574.github.io/tinhdiemzsm/
   ```

   Nếu dùng đường dẫn `index.html`, thêm chính xác địa chỉ đó vào danh sách redirect. Khi thử trên máy, thêm địa chỉ localhost đang sử dụng; không dùng wildcard cho tên miền không thuộc quyền quản lý của bạn.
5. Trong `access-config.js`, điền **Project URL** và **publishable key** của project:

   ```js
   window.ZSM_ACCESS_CONFIG = Object.freeze({
     supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
     supabasePublishableKey: 'sb_publishable_...'
   });
   ```

   Đây là cấu hình công khai cho trình duyệt. **Không dùng secret key, `service_role`, mật khẩu DB hay personal access token.** Mã cũng chấp nhận legacy `anon` key; từ chối secret/service-role key. Quyền dữ liệu vẫn do PostgreSQL kiểm tra.
6. Mở bản đã cấu hình qua HTTP, đăng ký tài khoản của bạn và xác nhận email. Đăng nhập sẽ hiện màn hình chờ duyệt.
7. Quay lại **SQL Editor**, thay email trong câu lệnh sau bằng email bạn vừa xác nhận rồi chạy. Đây là bước cấp quyền chủ sở hữu, không thực hiện từ trình duyệt:

   ```sql
   update public.zsm_profiles p
   set role = 'admin', status = 'approved', updated_at = now()
   where lower(p.email) = lower('EMAIL_BAN_VUA_DANG_KY')
     and exists (
       select 1 from auth.users u
       where u.id = p.id and u.email_confirmed_at is not null
     )
   returning id, email, role, status;
   ```

   Phải trả về đúng tài khoản của bạn. Nếu không có dòng nào, kiểm tra email và trạng thái xác nhận; không cấp quyền cho tài khoản không rõ danh tính.
8. Bấm **Kiểm tra lại**. Bạn sẽ vào công cụ và thấy **Quản lý tài khoản** ở góc dưới. Đăng ký thêm một tài khoản thử để kiểm tra chờ duyệt → duyệt → sử dụng → khóa → bị chặn.
9. Sau khi kiểm tra trên project thật, đưa các thay đổi đã cấu hình vào nhánh đang được GitHub Pages phục vụ. Pull request được chuẩn bị ở dạng draft để tránh vô tình thay website đang hoạt động bằng cấu hình trống.

## Cách sử dụng

- **Người mới:** đăng ký, xác nhận email, đăng nhập và chờ chủ website duyệt. Màn hình tự kiểm tra trạng thái mỗi 30 giây khi tab đang hiện; cũng có nút kiểm tra ngay.
- **Quản trị viên:** mở Quản lý tài khoản, chọn Chờ duyệt và bấm Duyệt. Dùng Khóa để thu hồi quyền; cần xác nhận trước khi khóa. Mở khóa chuyển tài khoản về trạng thái đã duyệt.
- **Quên mật khẩu:** dùng liên kết ở màn hình đăng nhập; mở email để đặt mật khẩu mới. Việc đổi mật khẩu không thay đổi trạng thái duyệt/khóa.
- **Bảng đấu cũ:** chỉ quản trị viên có nút Nhập dữ liệu cũ. Thao tác này sao chép dữ liệu chưa gắn tài khoản trên chính trình duyệt đó vào tài khoản hiện tại, có xác nhận và bản sao lưu; không xóa dữ liệu gốc.
- **Livestream:** mở từ các nút của bảng đấu. Tab livestream cũng cần tài khoản đã duyệt. Các tab cùng trình duyệt và cùng tài khoản tiếp tục đồng bộ; đăng xuất sẽ đóng quyền truy cập ở các tab đó. Thanh tài khoản trên màn hình livestream hiện khi rê chuột hoặc dùng bàn phím để không nằm trong khung hình bình thường.

## Dữ liệu và giới hạn cần biết

- Hồ sơ, trạng thái duyệt, quyền quản trị và nhật ký được lưu trong Supabase; RLS và các RPC kiểm tra quyền tại DB. Trạng thái/role trong metadata đăng ký không được tin cậy. Không có cơ chế “người đăng ký đầu tiên tự thành admin”.
- Tính điểm và kết quả BO được thực hiện qua `zsm_calculate`. Mỗi yêu cầu kiểm tra trạng thái **hiện tại trong DB**, nên tài khoản bị khóa không tính tiếp được bằng JWT cũ. Giao diện kiểm tra định kỳ và khi có yêu cầu bị từ chối. Cần Internet khi tính điểm; trong lúc chờ/lỗi, giao diện báo trạng thái và không cho xuất Excel với điểm chưa xác nhận.
- Bảng đấu, ảnh, danh mục và kỷ lục vẫn lưu **trên từng trình duyệt**, chia vùng theo tài khoản. Bản này chưa đồng bộ bảng đấu giữa các máy và chưa có liên kết xem công khai. Xóa dữ liệu trình duyệt có thể làm mất bảng đấu; nên xuất Excel trước.
- Không tự nhận dữ liệu cũ vào tài khoản mới: tránh người khác dùng cùng máy nhìn thấy bảng đấu của chủ máy. Local storage không phải kho bí mật chống người có quyền điều khiển máy/DevTools.
- “Hoạt động gần nhất” là thời điểm trình duyệt liên hệ hệ thống, được ghi tối đa một lần mỗi phút. Đây không phải số người online, lịch sử IP hay thống kê mọi khách ẩn danh.
- Website và lịch sử GitHub công khai có thể được sao chép, kể cả phiên bản tính điểm cũ chạy hoàn toàn trên máy. Chức năng này bảo vệ dịch vụ tính điểm và dữ liệu quản trị của bản đang triển khai; không thể thu hồi mã hay kết quả đã tải về. Thay đổi trạng thái không xóa dữ liệu đã lưu trên máy người dùng.
- Nếu cần nhiều chủ quản trị, cấp quyền qua SQL Editor sau khi xác minh tài khoản. Không đưa thao tác sửa `role` vào API dành cho thành viên. Giữ danh sách exposed schemas của Data API theo mặc định; không expose `zsm_private`.

## Kiểm thử

Không cần bước build để chạy website. Các thư viện npm dưới đây chỉ phục vụ kiểm thử:

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

- Kiểm thử DB dùng PostgreSQL trong PGlite, áp dụng trực tiếp hai migration, kiểm tra RLS, chống tự cấp quyền, khóa với danh tính/JWT cũ, audit và tính điểm. Hàng chục cấu hình được so sánh với bản gốc ở commit `74b38274b6ea29c726af89891e74831c5297ac12`.
- Kiểm thử trình duyệt chạy React/Babel thật và thay SDK bằng mock riêng trong Playwright; kiểm tra giao diện mobile, đăng ký, chờ duyệt, duyệt/khóa, reset mật khẩu, cách ly local storage, nhập dữ liệu cũ, lỗi mạng và đồng bộ livestream. Mock không được nạp bởi `index.html` và không có cờ bỏ qua đăng nhập trong code thật.
- Bộ kiểm thử không thay thế bước kiểm tra email, redirect, khóa tài khoản và kết nối trên Supabase thật trước khi phát hành.

Tham khảo: [Supabase Auth](https://supabase.com/docs/guides/auth), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [Database functions](https://supabase.com/docs/guides/database/functions).
