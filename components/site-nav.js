"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  readUserProfileFromStorage,
  USER_PROFILE_STORAGE_KEY,
} from "@/lib/user-profile-client";

const PLACEHOLDER_NAV = [
  { label: "空位1", href: "#" },
  { label: "空位2", href: "#" },
  { label: "空位3", href: "#" },
  { label: "空位4", href: "#" },
];

const SLOT5_LINK_CLASS =
  "rounded-full bg-[#15803D] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#166534]";

export default function SiteNav({ activePath = "/" }) {
  const [hasProfile, setHasProfile] = useState(false);

  useEffect(() => {
    function syncProfileState() {
      setHasProfile(Boolean(readUserProfileFromStorage()));
    }

    syncProfileState();

    function handleStorage(event) {
      if (event.key === USER_PROFILE_STORAGE_KEY || event.key === null) {
        syncProfileState();
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", syncProfileState);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", syncProfileState);
    };
  }, []);

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
          {hasProfile ? (
            <Link href="/profile" className={SLOT5_LINK_CLASS}>
              个人资料
            </Link>
          ) : (
            <Link href="/login" className={SLOT5_LINK_CLASS}>
              登录
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
