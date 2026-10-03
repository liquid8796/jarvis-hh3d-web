-- ============================================================================
-- KỊCH BẢN LUA DÀNH CHO LOGITECH G-HUB & CHUỘT LOGITECH G304
-- ============================================================================
-- Hướng dẫn cài đặt vào Logitech G-HUB:
-- 1. Mở ứng dụng Logitech G-HUB trên máy tính.
-- 2. Bấm vào biểu tượng chuột G304 (hoặc Profile "DESKTOP / DEFAULT").
-- 3. Bấm vào tab "SCRIPTING" (Biểu tượng cuốn sách / mã nguồn).
-- 4. Bấm "CREATE A NEW LUA SCRIPT" (hoặc sửa script hiện tại).
-- 5. Dán toàn bộ nội dung tệp này vào rồi bấm Script -> Save & Run (Ctrl + S).
--
-- Cách thức hoạt động:
-- - Khi auto chạy chế độ "Logitech G-HUB Assist", chuột sẽ tự động lướt đến đúng
--   vị trí quảng cáo trên Chrome và phát chuông báo.
-- - Bạn chỉ cần bấm nút hông G4 (Back) hoặc G5 (Forward) trên chuột G304:
--   Driver Logitech sẽ lập tức phát chuỗi rung lắc vi mô sinh học và thực hiện
--   click chuột trái 100% bằng driver kernel (logi_joy_vir_hid.sys).
-- ============================================================================

EnablePrimaryMouseButtonEvents(true)

function OnEvent(event, arg)
    -- Sự kiện khi bấm nút hông G4 (Back) hoặc G5 (Forward) trên chuột G304
    if event == "MOUSE_BUTTON_PRESSED" and (arg == 4 or arg == 5) then
        OutputLogMessage("[Logitech G304] Kích hoạt click quang cao tu driver phan cung...\n")

        -- 1. Rung lắc vi mô tự nhiên (Micro-jitter) như tay người đang giữ chuột
        for i = 1, math.random(8, 14) do
            local dx = math.random(-2, 2)
            local dy = math.random(-2, 2)
            MoveMouseRelative(dx, dy)
            Sleep(math.random(25, 60))
        end

        -- 2. Dwell time trước khi nhấn
        Sleep(math.random(150, 280))

        -- 3. Nhấn chuột trái (Button 1) qua driver kernel
        PressMouseButton(1)

        -- 4. Giữ chuột như ngón tay người thật
        Sleep(math.random(85, 145))

        -- 5. Nhả chuột trái
        ReleaseMouseButton(1)

        OutputLogMessage("[Logitech G304] Da phat click phan cung thanh cong!\n")
    end
end
