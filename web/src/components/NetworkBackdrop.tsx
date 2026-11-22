/**
 * Decorative topology with packets travelling along the links: a preview of
 * what the simulator shows. Pure SVG + SMIL, no JavaScript.
 */
const nodes = [
  { x: 80, y: 120 },
  { x: 260, y: 70 },
  { x: 430, y: 160 },
  { x: 180, y: 260 },
  { x: 360, y: 330 },
  { x: 540, y: 280 },
  { x: 120, y: 420 },
  { x: 470, y: 470 },
] as const;
const links: [number, number][] = [
  [0, 1], [1, 2], [0, 3], [1, 3], [2, 4], [3, 4], [2, 5], [4, 5], [3, 6], [4, 7], [5, 7], [6, 7],
];

export function NetworkBackdrop() {
  return (
    <svg className="absolute inset-0 h-full w-full opacity-60" viewBox="0 0 620 540" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {links.map(([a, b], i) => {
        const p = nodes[a]!;
        const q = nodes[b]!;
        return (
          <g key={i}>
            <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#9CC3FF" strokeOpacity="0.25" strokeWidth="1.5" />
            <circle r="3.5" fill={i % 3 === 0 ? "#FF6B57" : "#9CC3FF"}>
              <animateMotion dur={`${3 + (i % 4)}s`} begin={`${(i * 0.7) % 3}s`} repeatCount="indefinite" path={`M${p.x},${p.y} L${q.x},${q.y}`} />
            </circle>
          </g>
        );
      })}
      {nodes.map((n, i) => (
        <g key={i}>
          <circle cx={n.x} cy={n.y} r="16" fill="#16213A" stroke="#9CC3FF" strokeOpacity="0.5" />
          <circle cx={n.x} cy={n.y} r="4" fill={i % 2 ? "#9CC3FF" : "#FF6B57"} />
        </g>
      ))}
    </svg>
  );
}
