import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./utils/logger";

const port = env.port;

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {
    message: error.message,
    stack: error.stack,
  });
});

app.listen(port, () => {
  logger.info(`Server dang chay tai http://localhost:${port} (Model: ${env.geminiModel})`);
});

