import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import React, { ReactNode } from "react";
import { AuthProvider } from "@/lib/auth-context";
import { LayoutContentWrapper } from "@/components/LayoutContent";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "One Arsenal - WMS",
  description: "Complete WMS with inbound, outbound, and inventory management",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AuthProvider>
          <LayoutContentWrapper>
            {children}
          </LayoutContentWrapper>
        </AuthProvider>
      </body>
    </html>
  );
}
