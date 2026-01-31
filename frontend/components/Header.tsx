"use client";

import Link from "next/link";
import Image from "next/image";
import { User } from "lucide-react";

export default function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-surface border-b border-border">
      <div className="max-w-[1200px] mx-auto px-8 h-20 flex items-center justify-between">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center hover:opacity-90 transition-opacity">
          <Image src="/logo.jpeg" alt="SplicR" width={120} height={40} className="h-10 w-auto object-contain" priority />
        </Link>

        {/* User Icon */}
        <button className="w-10 h-10 rounded-full bg-background border border-border flex items-center justify-center hover:bg-accent transition-colors duration-200">
          <User className="w-5 h-5 text-text-primary" strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}
