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

## 4. Dịch nhiều ảnh trong một lần gọi

Sử dụng endpoint `POST http://localhost:3000/api/v1/translate-images` với
`multipart/form-data` trong Postman:

- Field `images`: chọn nhiều file ảnh JPG, PNG hoặc WEBP (tối đa 10 file, mỗi file tối đa 5MB).
- Field `source_language`: tùy chọn, mặc định là `auto`. Với `ocr_engine_mode=11`, hệ thống nhận diện script theo từng bubble rồi tự chọn model OCR phù hợp, giảm nhiễu từ SFX/logo trên toàn trang.
- Field `target_language`: tùy chọn, mặc định là `Vietnamese`.
- Field `ocr_engine_mode`: tùy chọn, dùng `5` hoặc `11` cho chế độ truyện tranh.
- Field `comic_format`: tùy chọn, dùng `manga`, `manhua_classic`, `manhua_modern`, `webtoon` hoặc `comic` để chọn thứ tự đọc.

Các ảnh được xử lý tuần tự để hạn chế tải CPU/RAM và quota Gemini. API trả HTTP
`200` khi tất cả ảnh thành công, hoặc `207` nếu một số ảnh lỗi. Trong cả hai
trường hợp, trường `data` chứa kết quả riêng theo từng `file_name`.

Khi dịch một ảnh truyện tranh bằng `POST /api/v1/translate-image`, có thể gửi:

```text
source_language=auto
ocr_engine_mode=11
comic_format=manga
```

Hệ thống sẽ tự chọn `jpn_vert` cho tiếng Nhật, `chi_sim_vert`/`chi_tra_vert`
cho chữ Hán, `kor+eng` cho tiếng Hàn, và `eng+vie` cho chữ Latin. Với chữ Hán,
OSD không phân biệt được giản thể và phồn thể nên hệ thống nạp cả hai model dọc.

Nếu không truyền `comic_format`, hệ thống tự suy ra theo ngôn ngữ nguồn cụ thể:
Nhật là `manga`, Trung phồn thể là `manhua_classic`, Trung giản thể là
`manhua_modern`, Hàn là `webtoon`. Với `source_language=auto`, nên truyền rõ
`comic_format` nếu cần kiểm soát thứ tự đọc.

Ở `source_language=auto` và `ocr_engine_mode=11`, hệ thống calibration theo cấp
trang: chọn tối đa 5 bubble lớn nhất, thử riêng `jpn_vert`, `chi_sim_vert` và
`chi_tra_vert`, cộng điểm của từng model rồi chốt model thắng cho toàn bộ trang.
Nếu điểm quá sát nhau hoặc confidence trung bình dưới 0.4, hệ thống gửi cả
chuỗi OCR Nhật và Trung cho Gemini để chọn theo ngữ cảnh thay vì tự trả kết quả
không đáng tin cậy.

Fast-pass hiện thử cả model chữ dọc và chữ thường cho từng ngôn ngữ:
`jpn_vert`/`jpn`, `chi_sim_vert`/`chi_sim`, `chi_tra_vert`/`chi_tra`. Sau khi
voting, OCR thật của toàn bộ bubble dùng model dọc đã chốt, phù hợp với manga
và manhua dạng chữ dọc.

Kết quả mode 11 có thêm `ocr_confidence` (confidence trung bình của Tesseract)
và `comic_format`. Đây là hai trường dùng để phân biệt chất lượng OCR với
`confidence_score` do Gemini trả về.
