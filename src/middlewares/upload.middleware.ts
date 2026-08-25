import multer from "multer";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const imageFileFilter: multer.Options["fileFilter"] = (
  _req,
  file,
  callback,
) => {
  if (!allowedMimeTypes.has(file.mimetype)) {
    callback(new Error("Chỉ chấp nhận file ảnh định dạng JPG, PNG hoặc WEBP!"));
    return;
  }

  callback(null, true);
};

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10,
  },
});
