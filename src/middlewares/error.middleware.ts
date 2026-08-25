import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/api-error";
import { logger } from "../utils/logger";

export const notFoundMiddleware = (_req: Request, res: Response): void => {
  res.status(404).json({
    status: "error",
    message: "Khong tim thay route yeu cau.",
  });
};

export const errorMiddleware = (
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json({
      status: "error",
      ...(error.code ? { error_code: error.code } : {}),
      message: error.message,
    });
    return;
  }

  const message =
    error instanceof Error ? error.message : "Loi he thong khong xac dinh.";

  logger.error(message, {
    stack: error instanceof Error ? error.stack : undefined,
  });

  res.status(500).json({
    status: "error",
    message,
  });
};
