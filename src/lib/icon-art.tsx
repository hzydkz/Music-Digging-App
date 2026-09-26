/** PWA/앱 아이콘용 레코드판 그림 (next/og ImageResponse에서 렌더링) */
export function RecordIcon({ size }: { size: number }) {
  const ring = (inset: number) => ({
    position: "absolute" as const,
    top: inset,
    left: inset,
    right: inset,
    bottom: inset,
    borderRadius: "50%",
    border: `${Math.max(1, size * 0.006)}px solid rgba(255,255,255,0.14)`,
  });
  return (
    <div
      style={{
        width: size,
        height: size,
        background: "#14120f",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "relative",
          width: size * 0.78,
          height: size * 0.78,
          borderRadius: "50%",
          background: "#231f1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={ring(size * 0.05)} />
        <div style={ring(size * 0.1)} />
        <div style={ring(size * 0.15)} />
        <div
          style={{
            width: size * 0.26,
            height: size * 0.26,
            borderRadius: "50%",
            background: "#e3895c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: size * 0.04, height: size * 0.04, borderRadius: "50%", background: "#14120f" }} />
        </div>
      </div>
    </div>
  );
}
