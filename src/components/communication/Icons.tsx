function IconBase({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function DirectIcon() {
  return (
    <IconBase>
      <path d="M5.5 5.5h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5.5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" />
      <path d="M8 10h8M8 13h5" />
    </IconBase>
  );
}

export function RoomIcon() {
  return (
    <IconBase>
      <path d="M4 5.5h11a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2H9l-3.5 2.5V15H4a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z" />
      <path d="M9 18.5h6l3.5 2.5v-2.5H20a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2" />
      <path d="M6 9h7M6 12h4" />
    </IconBase>
  );
}

export function MembersIcon() {
  return (
    <IconBase>
      <circle cx="12" cy="7.5" r="3.1" />
      <path d="M5.5 20v-2.2A5.8 5.8 0 0 1 11.3 12h1.4a5.8 5.8 0 0 1 5.8 5.8V20" />
    </IconBase>
  );
}

export function BackIcon() {
  return (
    <IconBase>
      <path d="m14.5 6-6 6 6 6" />
    </IconBase>
  );
}

export function SendIcon() {
  return (
    <IconBase>
      <path d="m3.5 4 17 8-17 8 3-8-3-8Z" />
      <path d="M6.5 12h14" />
    </IconBase>
  );
}
