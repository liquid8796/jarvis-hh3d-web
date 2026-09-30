import { Avatar } from "@/components/Avatar";
import { PRESENCE_LABEL, type PresenceStatus } from "@/lib/validation/presence";
import type { Member } from "./types";

export function StatusDot({ status }: { status: PresenceStatus }) {
  return <span className={`communication-status-dot is-${status}`} aria-hidden="true" />;
}

export function MemberRow({
  member,
  mine,
  onMessage,
}: {
  member: Member;
  mine: boolean;
  onMessage: () => void;
}) {
  return (
    <button
      type="button"
      className="communication-member-row"
      onClick={onMessage}
      disabled={mine}
      aria-label={mine ? `${member.displayName} — tài khoản của bạn` : `Trò chuyện với ${member.displayName}`}
    >
      <Avatar name={member.displayName} url={member.avatarUrl} size={38} />
      <span className="communication-member-copy">
        <span className="communication-member-name">
          {member.displayName}
          {mine && <em>Bạn</em>}
          {member.isAdmin && <em className="is-admin">Quản trị</em>}
        </span>
        <span className="communication-member-meta">
          <StatusDot status={member.presence} />
          {PRESENCE_LABEL[member.presence]} · @{member.username}
        </span>
      </span>
      {!mine && <span className="communication-member-action">Nhắn tin</span>}
    </button>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="communication-empty">
      <span aria-hidden="true">✦</span>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
