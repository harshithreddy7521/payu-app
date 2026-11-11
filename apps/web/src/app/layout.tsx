import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FeeApp — India Fee Collection",
  description: "Collect fees, memberships and payments via UPI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
