"use client";

import { useRouter } from "next/navigation";
import SiteNav from "@/components/site-nav";
import { saveUserProfileToStorage } from "@/lib/user-profile-client";

const MOCK_LOGIN_PROFILE = {
  age: 28,
  politicalStatus: "群众",
  major: "辅导员",
  isPartyMember: false,
};

function WeChatQrPlaceholder() {
  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label="微信扫码登录占位二维码"
      className="h-48 w-48 text-slate-300"
    >
      <rect x="0" y="0" width="200" height="200" fill="#ffffff" stroke="currentColor" strokeWidth="2" />
      <rect x="16" y="16" width="52" height="52" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect x="132" y="16" width="52" height="52" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect x="16" y="132" width="52" height="52" fill="none" stroke="currentColor" strokeWidth="6" />
      <rect x="28" y="28" width="28" height="28" fill="currentColor" />
      <rect x="144" y="28" width="28" height="28" fill="currentColor" />
      <rect x="28" y="144" width="28" height="28" fill="currentColor" />
      <rect x="88" y="88" width="12" height="12" fill="currentColor" />
      <rect x="108" y="88" width="8" height="8" fill="currentColor" />
      <rect x="88" y="108" width="8" height="8" fill="currentColor" />
      <rect x="104" y="104" width="16" height="16" fill="currentColor" />
      <rect x="128" y="96" width="8" height="24" fill="currentColor" />
      <rect x="96" y="128" width="24" height="8" fill="currentColor" />
      <rect x="152" y="152" width="32" height="32" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();

  function handleMockScanLogin() {
    saveUserProfileToStorage(MOCK_LOGIN_PROFILE);
    router.push("/");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <SiteNav activePath="/login" />

      <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-md items-center justify-center px-4 sm:px-8">
        <div className="w-full rounded-lg border border-slate-200 bg-white p-6 text-center">
          <div className="mx-auto flex w-fit items-center justify-center rounded-lg border border-slate-200 bg-white p-3">
            <WeChatQrPlaceholder />
          </div>
          <p className="mt-4 text-sm text-slate-700">微信扫码登录</p>
          <p className="mt-1 text-xs text-slate-500">请使用微信扫描二维码</p>

          <button
            type="button"
            onClick={handleMockScanLogin}
            className="mt-6 w-full rounded-lg bg-[#15803D] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#166534]"
          >
            模拟扫码登录
          </button>
        </div>
      </main>
    </div>
  );
}
