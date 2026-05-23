import "./globals.css";

export const metadata = {
  title: "岸边 / anBian.cn",
  description: "考编、申博、高校院所招聘聚合 — 你已经在岸边了",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
