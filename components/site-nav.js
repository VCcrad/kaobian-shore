import Link from "next/link";

const PLACEHOLDER_NAV = [
  { label: "空位1", href: "#" },
  { label: "空位2", href: "#" },
  { label: "空位3", href: "#" },
  { label: "空位4", href: "#" },
  { label: "空位5", href: "#" },
];

export default function SiteNav({ activePath = "/" }) {
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-200 bg-white">
      <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-semibold text-white"
            aria-hidden
          >
            岸
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-sm font-semibold tracking-tight text-slate-900 sm:text-base">
              岸边<span className="text-slate-400">/</span>
              <span className="font-medium text-slate-700">anBian.cn</span>
            </span>
            <span className="mt-0.5 block text-[11px] text-slate-500 sm:text-xs">
              你已经在岸边了，有感觉吗
            </span>
          </span>
        </Link>

        <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-2">
          <Link
            href="/"
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
              activePath === "/"
                ? "bg-slate-900 font-medium text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            首页
          </Link>
          {PLACEHOLDER_NAV.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-full px-3 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
