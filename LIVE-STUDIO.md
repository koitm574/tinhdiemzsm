# Phòng phát sóng ZSM

Trong trang tính điểm, mở **Phòng phát sóng**. Chọn cảnh và khung hình, kiểm tra bản xem trước rồi bấm **Lên sóng**. Hình phát giữ bản dữ liệu đã chốt trong khi bạn tiếp tục nhập điểm hoặc đổi cảnh xem trước. **Ẩn hình** xóa đồ họa của nguồn đang chọn.

| Cảnh | Nội dung |
| --- | --- |
| Tỷ số trên gameplay | Tỷ số đội hoặc tối đa ba vị trí dẫn đầu. Với 1v1, hiển thị tỷ số set và ván. |
| Trước trận | Tên map, số ván và danh sách tay đua. Dùng ảnh map từ Google Sheets khi có. |
| Kết quả ván | Hạng, thành tích và điểm hoặc người thắng ván 1v1. Mọi tay đua cần có thời gian hợp lệ hoặc X (DNF). |
| Bảng xếp hạng | Tổng điểm từ các ván đã đủ kết quả, hoặc tỷ số của cặp 1v1. |
| Tạm nghỉ | Màn hình chờ toàn khung. |
| Trận tiếp theo | Nêu bật cặp đấu sắp diễn ra, sau đó hiển thị tối đa bốn cặp kế tiếp. |
| Nhánh playoffs | Hai bán kết, chung kết và người vô địch. Chọn người thắng bán kết để điền suất chung kết. |

## Nhập và hoàn tác kết quả

- Nhấn **Enter** hoặc rời ô để chốt thời gian. Dùng **X** cho DNF và để trống để xóa kết quả. Thời gian sai định dạng giữ nguyên giá trị trước đó.
- Mở **Lịch sử kết quả**, chọn ván rồi bấm **Hoàn tác lần sửa gần nhất**. Điểm và xếp hạng được tính lại. Lịch sử giữ 24 thao tác gần nhất của mỗi ván và đi theo nhóm khi lưu nhóm.
- Nếu đã phát bảng điểm hoặc kết quả, bấm **Lên sóng** lại sau khi hoàn tác để cập nhật hình phát.

## Chuẩn bị lịch và playoffs

- Ở cảnh **Trận tiếp theo**, nhập tối đa 12 cặp đấu, giờ hoặc ghi chú rồi dùng các nút mũi tên để xếp thứ tự. Đánh dấu **Đã xong** để chuyển trận kế tiếp vào vị trí nổi bật trong bản xem trước.
- Ở cảnh **Nhánh playoffs**, nhập bốn hạt giống khác nhau. Hai bán kết ghép hạt giống 1 với 4, và 2 với 3. Đổi người thắng bán kết sẽ bỏ kết quả chung kết để bạn chọn lại.
- Lịch và nhánh đấu được lưu theo tài khoản trong trình duyệt đang dùng. Cả hai có thể chuẩn bị trước khi lên sóng, độc lập với nhóm chấm điểm đang mở.

## Nguồn phát

1. Chọn **Link OBS / TikTok** rồi bấm **Lên sóng** để tạo link. Link giữ nguyên khi đổi cảnh, hết hạn sau 12 giờ kể từ lần phát gần nhất và có thể thu hồi. Ai có link đều xem được hình đã phát.
2. Trong OBS, thêm **Browser Source**. Nếu TikTok LIVE Studio có nguồn **Link**, có thể dán URL vào đó.
3. Đặt nguồn phía trên gameplay và nhập kích thước theo canvas.

| Khung hình | Chiều rộng × chiều cao |
| --- | --- |
| Ngang 16:9 | 1920 × 1080 |
| Dọc 9:16 | 1080 × 1920 |

Nếu cần dùng **Window Capture**, chọn **Cửa sổ cùng trình duyệt**, bấm **Lên sóng** rồi **Mở hình phát**. Cửa sổ cần cùng hồ sơ trình duyệt với trang chấm điểm và có nền đục để thu hình.

[Hướng dẫn Browser Source của OBS](https://obsproject.com/kb/Browser-Source)

## Cài đặt

- Triển khai `index.html`, `live-config.js`, `live-operations.js` và `live-overlay.html` trong cùng thư mục HTTPS.
- Áp dụng migration `live_frames` trong `supabase/migrations/` vào project Supabase của ứng dụng. Migration dùng `zsm_profiles` và `zsm_private.session_is_active()` có sẵn.
- Trước buổi phát, mở link bằng cửa sổ ẩn danh để kiểm tra quyền xem. Thử hoàn tác một kết quả, đổi trận kế tiếp, đổi người thắng bán kết và thu hồi link. Nếu một nguồn Browser đang mở từ phiên bản cũ, làm mới nguồn trước khi thử các cảnh mới. Kiểm tra vị trí đồ họa trên gameplay trong OBS Preview hoặc TikTok LIVE Studio.
