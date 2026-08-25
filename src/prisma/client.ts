// src/prisma/client.ts
// Khởi tạo và export PrismaClient để dùng chung trong ứng dụng
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export default prisma;
