import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { Navbar } from "@/components/Navbar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_CENTER_NAME ?? "Scheduler",
  description: "Tutor scheduling and management",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const navCollapsed = cookieStore.get('navbarCollapsed')?.value === 'true';

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="app-shell">
          <Navbar initialCollapsed={navCollapsed} />
          <main className="app-main w-full">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}