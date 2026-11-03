# Phòng phát sóng ZSM

Trong trang tính điểm, mở **Phòng phát sóng**. Chọn cảnh và khung hình, kiểm tra bản xem trước rồi bấm **Lên sóng**. Hình phát giữ bản dữ liệu đã chốt trong khi bạn tiếp tục nhập điểm hoặc đổi cảnh xem trước. **Ẩn hình** xóa đồ họa của nguồn đang chọn.

| Cảnh | Nội dung |
| --- | --- |
| Tỷ số trên gameplay | Tỷ số đội hoặc tối đa ba vị trí dẫn đầu. Với 1v1, hiển thị tỷ số set và ván. |
| Trước trận | Tên map, số ván và danh sách tay đua. Dùng ảnh map từ Google Sheets khi có. |
| Kết quả ván | Hạng, thành tích và điểm hoặc người thắng ván 1v1. Mọi tay đua cần có thời gian hợp lệ hoặc X (DNF). |
| Bảng xếp hạng | Tổng điểm từ các ván đã đủ kết quả, hoặc tỷ số của cặp 1v1. |
| Tạm nghỉ | Màn hình chờ toàn khung. |

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

- Triển khai `index.html`, `live-config.js` và `live-overlay.html` trong cùng thư mục HTTPS.
- Áp dụng migration `live_frames` trong `supabase/migrations/` vào project Supabase của ứng dụng. Migration dùng `zsm_profiles` và `zsm_private.session_is_active()` có sẵn.
- Trước buổi phát, mở link bằng cửa sổ ẩn danh để kiểm tra quyền xem. Thử đổi cảnh, ẩn đồ họa, thu hồi link rồi phát lại. Kiểm tra vị trí đồ họa trên gameplay trong OBS Preview hoặc TikTok LIVE Studio.
