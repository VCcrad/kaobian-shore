"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SiteNav from "@/components/site-nav";
import {
  DEFAULT_USER_PROFILE,
  readUserProfileFromStorage,
  saveUserProfileToStorage,
} from "@/lib/user-profile-client";

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none";

export default function ProfilePage() {
  const router = useRouter();
  const [age, setAge] = useState(String(DEFAULT_USER_PROFILE.age));
  const [politicalStatus, setPoliticalStatus] = useState("群众");
  const [major, setMajor] = useState(DEFAULT_USER_PROFILE.major);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = readUserProfileFromStorage();
    if (saved) {
      setAge(String(saved.age));
      setPoliticalStatus(saved.isPartyMember ? "中共党员" : "群众");
      setMajor(saved.major);
    }
    setReady(true);
  }, []);

  function handleSubmit(event) {
    event.preventDefault();

    const parsedAge = Number.parseInt(String(age).trim(), 10);
    saveUserProfileToStorage({
      age: Number.isFinite(parsedAge) ? parsedAge : DEFAULT_USER_PROFILE.age,
      major: major.trim() || DEFAULT_USER_PROFILE.major,
      isPartyMember: politicalStatus === "中共党员",
      politicalStatus,
    });

    router.push("/");
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <SiteNav activePath="/profile" />

      <main className="mx-auto max-w-lg px-4 py-6 sm:px-8">
        <div className="mb-6">
          <Link
            href="/"
            className="text-xs text-slate-500 transition-colors hover:text-slate-700"
          >
            ← 返回首页
          </Link>
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900">
            我的资料
          </h1>
          <p className="mt-1 text-xs text-slate-500">用于岗位匹配 · 保存在本浏览器</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-slate-200 bg-white p-4"
        >
          <label className="mb-4 block">
            <span className="mb-1 block text-xs text-slate-500">年龄</span>
            <input
              type="number"
              min={18}
              max={99}
              value={age}
              onChange={(event) => setAge(event.target.value)}
              className={inputClass}
              disabled={!ready}
            />
          </label>

          <fieldset className="mb-4">
            <legend className="mb-2 block text-xs text-slate-500">政治面貌</legend>
            <div className="flex flex-wrap gap-4 text-sm text-slate-700">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="politicalStatus"
                  value="群众"
                  checked={politicalStatus === "群众"}
                  onChange={() => setPoliticalStatus("群众")}
                  disabled={!ready}
                  className="text-slate-900 focus:ring-slate-400"
                />
                群众
              </label>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="politicalStatus"
                  value="中共党员"
                  checked={politicalStatus === "中共党员"}
                  onChange={() => setPoliticalStatus("中共党员")}
                  disabled={!ready}
                  className="text-slate-900 focus:ring-slate-400"
                />
                中共党员
              </label>
            </div>
          </fieldset>

          <label className="mb-6 block">
            <span className="mb-1 block text-xs text-slate-500">专业</span>
            <input
              type="text"
              value={major}
              onChange={(event) => setMajor(event.target.value)}
              placeholder="例如：辅导员"
              className={inputClass}
              disabled={!ready}
            />
          </label>

          <button
            type="submit"
            disabled={!ready}
            className="w-full rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            保存
          </button>
        </form>
      </main>
    </div>
  );
}
