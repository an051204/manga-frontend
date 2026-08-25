export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "API Dich Anh OCR + Gemini",
    version: "1.0.0",
    description:
      "REST API nhan anh, trich xuat van ban bang OCR, sau do sua loi va dich thuat bang Google Gemini.",
  },
  servers: [
    {
      url: "http://localhost:3000",
      description: "Local development server",
    },
  ],
  tags: [
    {
      name: "System",
      description: "Health check",
    },
    {
      name: "Translation",
      description: "OCR va dich thuat anh sang van ban",
    },
    {
      name: "History",
      description: "Tra cuu lich su dich anh",
    },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["System"],
        summary: "Kiem tra trang thai he thong",
        responses: {
          200: {
            description: "Server dang hoat dong binh thuong",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "success" },
                    message: {
                      type: "string",
                      example: "API dich anh dang hoat dong",
                    },
                  },
                  required: ["status", "message"],
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/translate-image": {
      get: {
        tags: ["Translation"],
        summary: "Thong bao dung sai method",
        responses: {
          405: {
            description: "Chi ho tro POST multipart/form-data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "error" },
                    message: {
                      type: "string",
                      example:
                        "Endpoint nay chi ho tro POST multipart/form-data. Hay upload anh qua form hoac Swagger Try it out.",
                    },
                  },
                  required: ["status", "message"],
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Translation"],
        summary: "Nhan anh va tra ve OCR da sua loi + ban dich",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["image"],
                properties: {
                  image: {
                    type: "string",
                    format: "binary",
                    description: "File anh (jpg/png/webp) - field name = image",
                  },
                  source_language: {
                    type: "string",
                    description:
                      "Ngon ngu dau vao: auto, eng+vie, jpn, kor, chi_sim, chi_tra",
                  },
                  ocr_engine_mode: {
                    type: "integer",
                    description:
                      "Che do OCR; set 5 (PSM 5) hoac 11 (PSM 11 Sparse Text) cho truyen tranh/comic. Ho tro eng, jpn, chi_sim, chi_tra, kor.",
                  },
                  target_language: {
                    type: "string",
                    description: "Ngon ngu dich (vi du: Vietnamese, English)",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Xu ly thanh cong",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "success" },
                    data: {
                      type: "object",
                      properties: {
                        detected_source_language: {
                          type: "string",
                          example: "ja",
                        },
                        original_ocr_text: {
                          type: "string",
                          example: "Helo wrld",
                        },
                        reconstructed_text: {
                          type: "string",
                          example: "Hello world",
                        },
                        translated_text: {
                          type: "string",
                          example: "Xin chao the gioi",
                        },
                        confidence_score: {
                          type: "string",
                          example: "0.92",
                        },
                      },
                      required: [
                        "detected_source_language",
                        "original_ocr_text",
                        "reconstructed_text",
                        "translated_text",
                        "confidence_score",
                      ],
                    },
                  },
                  required: ["status", "data"],
                },
              },
            },
          },
          400: {
            description: "Request khong hop le",
          },
          500: {
            description: "Loi OCR hoac LLM",
          },
        },
      },
    },
    "/api/v1/translations": {
      get: {
        tags: ["History"],
        summary: "Lay lich su cac lan dich anh",
        parameters: [
          {
            in: "query",
            name: "page",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              default: 1,
            },
            description: "So trang hien tai",
          },
          {
            in: "query",
            name: "limit",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              default: 10,
            },
            description: "So ban ghi tren moi trang",
          },
        ],
        responses: {
          200: {
            description: "Lay lich su thanh cong",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "success" },
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "integer", example: 1 },
                          image_name: {
                            type: "string",
                            example: "sample.png",
                          },
                          original_ocr_text: {
                            type: "string",
                            example: "Helo wrld",
                          },
                          translated_text: {
                            type: "string",
                            example: "Xin chao the gioi",
                          },
                          source_language: {
                            type: "string",
                            example: "eng+vie",
                          },
                          target_language: {
                            type: "string",
                            example: "Vietnamese",
                          },
                          confidence_score: {
                            type: "string",
                            example: "0.92",
                          },
                          created_at: {
                            type: "string",
                            format: "date-time",
                          },
                        },
                        required: [
                          "id",
                          "image_name",
                          "original_ocr_text",
                          "translated_text",
                          "source_language",
                          "target_language",
                          "confidence_score",
                          "created_at",
                        ],
                      },
                    },
                    total: { type: "integer", example: 25 },
                    currentPage: { type: "integer", example: 1 },
                    totalPages: { type: "integer", example: 3 },
                  },
                  required: [
                    "status",
                    "data",
                    "total",
                    "currentPage",
                    "totalPages",
                  ],
                },
              },
            },
          },
          400: {
            description: "Tham so phan trang khong hop le",
          },
          500: {
            description: "Loi he thong",
          },
        },
      },
    },
  },
} as const;
