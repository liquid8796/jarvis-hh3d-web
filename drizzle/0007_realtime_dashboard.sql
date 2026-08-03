-- PostgreSQL là "chuông cửa" của Linh Đài. Mỗi thay đổi đáng để người dùng nhìn thấy phát
-- đúng một NOTIFY trong chính transaction đã ghi dữ liệu; SSE đang LISTEN sẽ thức dậy và
-- đọc snapshot mới. Payload chỉ mang scope/topic, tuyệt đối không mang log hay bí mật.

CREATE OR REPLACE FUNCTION "jarvis_notify_job_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_user text;
BEGIN
  target_user := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id::text ELSE NEW.user_id::text END;
  PERFORM pg_notify(
    'jarvis_dashboard',
    json_build_object('userId', target_user, 'topic', 'job')::text
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "jarvis_dashboard_job_lifecycle"
AFTER INSERT OR DELETE ON "automation_jobs"
FOR EACH ROW EXECUTE FUNCTION "jarvis_notify_job_change"();
--> statement-breakpoint
CREATE TRIGGER "jarvis_dashboard_job_visible_update"
AFTER UPDATE OF "status", "next_run_at", "attempts", "worker_id" ON "automation_jobs"
FOR EACH ROW EXECUTE FUNCTION "jarvis_notify_job_change"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "jarvis_notify_event_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_user text;
BEGIN
  SELECT user_id::text INTO target_user FROM automation_jobs WHERE id = NEW.job_id;
  IF target_user IS NOT NULL THEN
    PERFORM pg_notify(
      'jarvis_dashboard',
      json_build_object('userId', target_user, 'topic', 'event')::text
    );
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "jarvis_dashboard_event_insert"
AFTER INSERT ON "job_events"
FOR EACH ROW EXECUTE FUNCTION "jarvis_notify_event_insert"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "jarvis_notify_worker_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_user text;
BEGIN
  target_user := CASE
    WHEN TG_OP = 'DELETE' THEN COALESCE(OLD.user_id::text, '*')
    ELSE COALESCE(NEW.user_id::text, '*')
  END;
  PERFORM pg_notify(
    'jarvis_dashboard',
    json_build_object('userId', target_user, 'topic', 'presence')::text
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "jarvis_dashboard_worker_lifecycle"
AFTER INSERT OR DELETE ON "workers"
FOR EACH ROW EXECUTE FUNCTION "jarvis_notify_worker_change"();
--> statement-breakpoint
CREATE TRIGGER "jarvis_dashboard_worker_seen"
AFTER UPDATE OF "user_id", "last_seen" ON "workers"
FOR EACH ROW EXECUTE FUNCTION "jarvis_notify_worker_change"();
