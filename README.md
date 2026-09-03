# Hướng dẫn chạy dự án API Dịch Ảnh OCR + Gemini

Dự án gồm 2 service: Backend Node.js/TypeScript (`app`) và Microservice Python/FastAPI (`cv-service`).

## 1. Chạy dự án bằng XAMPP (Local) & Các lệnh Prisma

Sử dụng XAMPP để cung cấp máy chủ cơ sở dữ liệu MySQL cục bộ thay thế cho Docker.

### Thao tác bắt buộc trên XAMPP Control Panel:

1. Mở **XAMPP Control Panel**.
2. Nhấn **Start** ở dòng **MySQL** (Bắt buộc để hệ thống có database hoạt động).
3. Nhấn **Start** ở dòng **Apache** (Chỉ bật nếu bạn cần xem hoặc phục vụ file tĩnh trong thư mục `public`, không bắt buộc đối với API).
4. Truy cập `http://localhost/phpmyadmin` (hoặc dùng DBeaver) tạo một database theo tên cấu hình (VD: `apidich_anh`).

### Cấu hình môi trường (.env):

File `.env` phải trỏ `DATABASE_URL` về MySQL của XAMPP:

env
DATABASE_URL="mysql://root:@127.0.0.1:3306/apidich_anh"
CV_SERVICE_URL=http://localhost:8001
GEMINI_API_KEY=your_google_gemini_api_key

### Các lệnh quản lý Prisma và chạy Backend (Node.js):

Mở terminal tại thư mục gốc và chạy lần lượt:

npm install # Cài đặt toàn bộ thư viện dependencies
npx prisma generate # Tạo Prisma Client để code TypeScript có thể tương tác với DB
npm run db:push # Đồng bộ cấu trúc schema của Prisma thẳng lên database XAMPP
npm run dev # Khởi động server Node.js (tự động reload khi sửa code logic)

### Các lệnh chạy CV Service (Python):

Mở một terminal thứ 2:

cd cv-service
pip install -r requirements.txt # Cài đặt thư viện Python cần thiết
python main.py # Khởi động service xử lý ảnh

---

## 2. Quản lý & Chạy dự án bằng Docker (Khuyên dùng)

Hệ thống Docker đã được thiết lập sẵn mount volume để tự động đồng bộ code giữa máy local và container.

### Các lệnh khởi chạy:

- **Chạy khi dự án đã hoàn thiện (Nhanh & Chạy nền):**

  docker compose up -d

- **Chạy toàn bộ hệ thống & Build lại image (có in log ra màn hình):**

  docker compose up --build

- **Chạy nền (Background) kèm Build lại image:**

  docker compose up --build -d

### Kiểm soát cập nhật code linh hoạt:

- **Khi thay đổi file logic (`.ts`, `.py`):**
  Bạn **chỉ cần nhấn Lưu (Save)** file trên máy local. Container đang dùng `tsx watch` và `uvicorn --reload` sẽ tự động bắt sự kiện và khởi động lại luồng chạy bên trong ngay lập tức mà không cần gõ lệnh.
- **Khi tiến trình tự động reload bị treo/lag:**

  docker compose restart

- **Khi cập nhật cấu trúc hệ thống (Sửa `package.json`, `requirements.txt`, `prisma/schema.prisma` hoặc file AI model):**
  Lúc này bắt buộc phải build lại image Docker từ đầu để nhận cấu trúc mới:

  docker compose down
  docker compose up --build -d

  **Cập nhật .env (Thay đổi key API Gemini)**

  # 1. Edit .env (thay key Gemini)

  nano .env

  # 2. Restart container (chỉ 5-10 giây)

  docker compose restart app

  # 3. Xem key hiện tại trong container

  docker compose exec app env
  grep GEMINI_API_KEY

### Các lệnh giám sát và gỡ lỗi (Debug):

- **Theo dõi log realtime (Rất quan trọng khi code bị lỗi):**

  docker compose logs -f app # Theo dõi Node.js / Prisma / API
  docker compose logs -f cv-service # Theo dõi Python / OpenCV / YOLO

- **Dừng hệ thống an toàn:**

  docker compose down

- **Xóa sạch dữ liệu (Reset hoàn toàn MySQL trong Docker):**

  docker compose down -v

---

## 3. Các URL Kiểm tra (Health Check)

Sau khi chạy bằng bất kỳ cách nào, hãy vào các link sau để xác nhận hệ thống đã online:

- API chính thức: `http://localhost:3000`
- Tài liệu API (Swagger): `http://localhost:3000/api-docs`
- Trạng thái CV Service: `http://localhost:8001/health`
