"use client";

import { useSidebar } from '@/lib/context/SidebarContext';
import { cn } from '@/lib/utils';

export default function AppFooter() {
  const { isMinimized } = useSidebar();

  return (
    <footer
      className={cn(
        'mt-auto border-t border-border bg-surface/80 backdrop-blur-sm transition-all duration-200 ease-in-out',
        isMinimized ? 'ml-sidebar-min' : 'ml-sidebar-max'
      )}
    >
      <div className="mx-auto max-w-6xl px-6 py-6 text-center">
        <p className="text-sm text-text-secondary max-w-xl mx-auto">
          Your privacy and security are important to us.
        </p>
        <p className="text-sm text-text-secondary max-w-xl mx-auto mt-1">
          SplicR is committed to protecting your data and maintaining the highest standards of security.
        </p>
        <nav className="mt-4 flex items-center justify-center gap-2 text-sm text-text-tertiary" aria-label="Legal">
          <a
            href="https://splicr.org/privacy-and-security"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-primary transition-colors"
          >
            Privacy & Security
          </a>
          <span className="text-border" aria-hidden>•</span>
          <a
            href="https://splicr.org/terms-and-conditions"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-primary transition-colors"
          >
            Terms & Conditions
          </a>
        </nav>
      </div>
    </footer>
  );
}
