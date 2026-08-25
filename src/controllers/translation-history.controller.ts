import { NextFunction, Request, Response } from "express";
import prisma from "../prisma/client";
import { ApiError } from "../utils/api-error";

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

const parsePaginationValue = (
  value: unknown,
  fallback: number,
  fieldName: string,
): number => {
  if (typeof value === "undefined") {
    return fallback;
  }

  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsedValue = Number.parseInt(String(rawValue), 10);

  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new ApiError(`${fieldName} phai la so nguyen duong.`, 400);
  }

  return parsedValue;
};

export const translationHistoryController = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const page = parsePaginationValue(req.query.page, DEFAULT_PAGE, "page");
    const limit = parsePaginationValue(req.query.limit, DEFAULT_LIMIT, "limit");
    const skip = (page - 1) * limit;

    try {
      const [total, data] = await Promise.all([
        prisma.translationHistory.count(),
        prisma.translationHistory.findMany({
          skip,
          take: limit,
          orderBy: {
            created_at: "desc",
          },
        }),
      ]);

      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

      res.status(200).json({
        status: "success",
        data,
        total,
        currentPage: page,
        totalPages,
      });
    } catch (dbErr) {
      res.status(200).json({
        status: "success",
        data: [],
        total: 0,
        currentPage: page,
        totalPages: 0,
      });
    }
  } catch (error) {
    next(error);
  }
};
