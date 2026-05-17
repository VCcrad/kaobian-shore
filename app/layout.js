import "./globals.css";

export const metadata = {
  title: "岸边 | anBian-web",
  description: "考公、考编、读博、高校编制数据整合平台",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
