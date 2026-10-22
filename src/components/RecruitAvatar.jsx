export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export default function RecruitAvatar({ name, src, size = 48 }) {
  const style = { width: size, height: size, fontSize: size < 40 ? 12 : 14 };
  if (src) {
    return <img src={src} alt="" className="avatar" style={style} />;
  }
  return (
    <span className="avatar" style={style} aria-hidden="true">{initials(name)}</span>
  );
}
