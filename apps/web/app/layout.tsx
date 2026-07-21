// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";
import "@web/app/globals.css";

export const metadata = {
  title: "Screenshot Studio",
  description: "App store screenshot editor and shared render host",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
