import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { readdirSync } from "node:fs";
import swaggerUi from "swagger-ui-express";
import { openApiSpec } from "./docs/openapi";
import translateImageRouter from "./routes/translate-image.route";
import translationHistoryRouter from "./routes/translation-history.route";
import {
  errorMiddleware,
  notFoundMiddleware,
} from "./middlewares/error.middleware";
import { logger, morganStream } from "./utils/logger";

export const app = express();
app.set("trust proxy", true);

// --- BẬT CORS MỞ TOANG CỬA CHO BACKEND ---
app.use(cors());
app.options("*", cors());

// ==========================================
// 2. CÁC MIDDLEWARE KHÁC ĐẶT Ở DƯỚI
// ==========================================
app.use(morgan("combined", { stream: morganStream }));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use(express.static(path.join(process.cwd(), "public")));

app.get("/health", (_req, res) => {
  logger.http("Health check endpoint was called.");
  res.status(200).json({
    status: "success",
    message: "API dich anh dang hoat dong",
  });
});

app.get("/api-docs.json", (_req, res) => {
  res.status(200).json(openApiSpec);
});

const swaggerDocsCustomCss = `
  #api-docs-home-button {
    position: fixed;
    bottom: 16px;
    right: 16px;
    z-index: 1000;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 999px;
    background: linear-gradient(135deg, #22c55e, #38bdf8);
    color: #04111f;
    font-weight: 800;
    text-decoration: none;
    box-shadow: 0 12px 28px rgba(2, 6, 23, 0.22);
    border: 0;
  }

  #api-docs-home-button:hover,
  #api-docs-home-button:focus-visible {
    color: #04111f;
    text-decoration: none;
    transform: translateY(-1px);
    box-shadow: 0 16px 34px rgba(2, 6, 23, 0.28);
  }

  @media (max-width: 767.98px) {
    #api-docs-home-button {
      top: 12px;
      right: 12px;
      padding: 0.65rem 0.85rem;
      font-size: 0.875rem;
    }
  }
`;

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customCss: swaggerDocsCustomCss,
    customJs: "/api-docs-home-button.js",
  }),
);

app.use("/api/v1", translateImageRouter);
app.use("/api/v1", translationHistoryRouter);

app.use(notFoundMiddleware);
app.use(errorMiddleware);
