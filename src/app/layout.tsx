import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IdeaGen AI - Tạo Ý Tưởng Sáng Tạo",
  description: "Công cụ tạo ý tưởng AI mạnh mẽ cho Performance Marketing. Tự động cập nhật dữ liệu app từ Google Play & App Store.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
