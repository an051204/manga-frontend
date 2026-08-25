import { Router } from "express";
import { translationHistoryController } from "../controllers/translation-history.controller";

const translationHistoryRouter = Router();

/**
 * @openapi
 * /api/v1/translations:
 *   get:
 *     summary: "Lay lich su cac lan dich anh"
 *     tags:
 *       - History
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: "So trang hien tai"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 10
 *         description: "So ban ghi tren moi trang"
 *     responses:
 *       200:
 *         description: "Lay lich su thanh cong"
 */
translationHistoryRouter.get("/translations", translationHistoryController);

export default translationHistoryRouter;
