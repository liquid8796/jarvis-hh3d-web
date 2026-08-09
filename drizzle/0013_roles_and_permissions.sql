CREATE TABLE "permissions" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_code" text NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "role_permissions_role_code_permission_code_pk" PRIMARY KEY("role_code","permission_code")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_code_pk" PRIMARY KEY("user_id","role_code")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."roles"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."roles"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_roles_role_code_idx" ON "user_roles" USING btree ("role_code");--> statement-breakpoint
-- Danh mục vai. Nhãn và thứ tự phải khớp ROLE_LABEL/ASSIGNABLE_ROLES trong
-- src/lib/auth/permissions.ts; `npm run verify:roles` so từng dòng và đỏ khi lệch.
INSERT INTO "roles" ("code", "label", "sort_order") VALUES
  ('gia-chu', 'Gia chủ', 0),
  ('thai-thuong-truong-lao', 'Thái thượng trưởng lão', 1),
  ('chuong-mon', 'Chưởng môn', 2),
  ('admin', 'Trưởng môn', 3)
ON CONFLICT ("code") DO UPDATE SET "label" = excluded."label", "sort_order" = excluded."sort_order";--> statement-breakpoint
INSERT INTO "permissions" ("code", "label") VALUES
  ('admin.panel', 'Vào trang Tông Môn'),
  ('member.manage', 'Quản môn đồ thường'),
  ('role_bearer.manage', 'Quản cả người mang vai'),
  ('role.assign', 'Ban và thu vai'),
  ('chat.purge', 'Thanh tẩy sảnh đàm đạo')
ON CONFLICT ("code") DO UPDATE SET "label" = excluded."label";--> statement-breakpoint
-- Gia chủ nhận TRỌN danh mục quyền, viết bằng một phép quét bảng chứ không phải năm dòng
-- chép tay — y như ROLE_PERMISSIONS['gia-chu'] nhận nguyên hằng PERMISSIONS bên code.
INSERT INTO "role_permissions" ("role_code", "permission_code")
SELECT 'gia-chu', "code" FROM "permissions"
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Ba vai bậc trị sự ngang nhau, nên chúng là một phép nhân chứ không phải ba danh sách.
INSERT INTO "role_permissions" ("role_code", "permission_code")
SELECT r.code, p.code
FROM (VALUES ('thai-thuong-truong-lao'), ('chuong-mon'), ('admin')) AS r(code)
CROSS JOIN (VALUES ('admin.panel'), ('member.manage')) AS p(code)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Di dân: users.roles (cột mảng) -> user_roles (bảng thật). Phép JOIN với "roles" khiến mã
-- lạ nếu có bị bỏ lại thay vì làm ngã khoá ngoại. Idempotent, chạy lại được để vá khe hẹp
-- giữa lúc migrate và lúc deploy — xem ghi chú tại cột users.roles trong schema.ts.
INSERT INTO "user_roles" ("user_id", "role_code")
SELECT u."id", r."code" FROM "users" u JOIN "roles" r ON r."code" = ANY(u."roles")
ON CONFLICT DO NOTHING;