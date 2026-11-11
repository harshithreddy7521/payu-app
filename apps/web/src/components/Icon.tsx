export default function Icon({
  name,
  size = 20,
}: {
  name: string;
  size?: number;
}) {
  const paths: Record<string, string> = {
    pay: "M12 3v18M7 7h7a4 4 0 0 1 0 8H7m0-4h10",
    dashboard: "M3 3h7v7H3zM14 3h7v11h-7zM3 14h7v7H3zM14 18h7v3h-7z",
    members:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    groups: "M3 7h7l2 2h9v11H3zM3 7V4h7l2 3",
    transactions: "M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4",
    settlements: "m3 10 9-7 9 7H3m2 3v6m7-6v6m7-6v6M3 22h18",
    settings:
      "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
    reminders: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    logout: "M9 3H3v18h6m5-14 5 5-5 5M8 12h11",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.pay} />
    </svg>
  );
}
