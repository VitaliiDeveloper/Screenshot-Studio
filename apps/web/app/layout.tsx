import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Screenshot Studio",
  description: "Phase 0 render host",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
