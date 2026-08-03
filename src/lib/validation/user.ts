import { z } from "zod";

/** One source of truth for identity fields shared by registration, profile and admin forms. */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Đạo hiệu cần ít nhất 3 ký tự.")
  .max(32, "Đạo hiệu tối đa 32 ký tự.")
  .regex(/^[a-zA-Z0-9_.-]+$/, "Đạo hiệu chỉ gồm chữ, số, gạch dưới, chấm, gạch ngang.");

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Danh xưng cần 2–64 ký tự.")
  .max(64, "Danh xưng cần 2–64 ký tự.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email tối đa 254 ký tự.")
  .email("Email không hợp lệ.");

export const passwordSchema = z
  .string()
  .min(8, "Mật khẩu cần ít nhất 8 ký tự.")
  .max(128, "Mật khẩu quá dài.");
