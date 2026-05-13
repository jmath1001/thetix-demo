import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Analytics } from "@vercel/analytics/next";

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

  // Fetch center name from DB so settings changes reflect immediately
  let centerName: string | undefined;
  let centerShort: string | undefined;
  try {
    const sbAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const centerId = process.env.NEXT_PUBLIC_CENTER_ID;
    if (centerId) {
      const { data } = await sbAdmin
        .from('slake_center_settings')
        .select('center_name, center_short_name')
        .eq('center_id', centerId)
        .maybeSingle();
      if (data?.center_name) centerName = data.center_name;
      if (data?.center_short_name) centerShort = data.center_short_name;
    }
  } catch {
    // fall through — Navbar will use env var fallback
  }

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="app-shell">
          <Navbar initialCollapsed={navCollapsed} centerName={centerName} centerShort={centerShort} />
          <main className="app-main w-full">
            {children}
          </main>
        </div>
        <Analytics />
      </body>
    </html>
  );
}