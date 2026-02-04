"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { ReactNode } from "react";

interface ButtonProps {
  children: ReactNode;
  onClick?: (e?: any) => void;
  variant?: "primary" | "secondary" | "outline";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit" | "reset";
}

export default function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled = false,
  className,
  type = "button",
}: ButtonProps) {
  const baseStyles =
    "rounded-xl font-serif transition-all duration-200 active:scale-[0.98] focus:outline-none focus-visible:outline-2 focus-visible:outline-text-primary focus-visible:outline-offset-2 inline-flex items-center justify-center";

  const variants = {
    primary: "bg-accent hover:bg-[#D9F03E] text-text-primary shadow-card",
    secondary: "bg-surface hover:bg-background text-text-primary border border-border shadow-card",
    outline: "border-2 border-border text-text-primary hover:border-text-primary hover:bg-background",
  };

  const sizes = {
    sm: "px-4 py-2 text-sm",
    md: "px-6 py-3 text-base",
    lg: "px-8 py-4 text-lg",
  };

  const disabledStyles = "opacity-50 cursor-not-allowed";

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      whileHover={!disabled ? { scale: 1.02 } : {}}
      whileTap={!disabled ? { scale: 0.98 } : {}}
      className={cn(
        baseStyles,
        variants[variant],
        sizes[size],
        disabled && disabledStyles,
        className
      )}
    >
      {children}
    </motion.button>
  );
}
