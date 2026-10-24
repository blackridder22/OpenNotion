import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenNotion",
  description: "An open source, Notion-style workspace",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
