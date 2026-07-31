import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Layout from "@/components/Layout/Layout";
import { cookies } from "next/headers";
import { verifyToken } from "@/lib/auth";
import { extractRole } from "@/lib/roles";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Sales CRM | Real Estate",
  description: "Advanced CRM for Real Estate Sales",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = cookies();
  const token = cookieStore.get('auth_token')?.value;

  let userRole = 'manager';

  if (token) {
    try {
      const { payload } = await verifyToken(token);
      if (payload && typeof payload !== 'string') {
        userRole = extractRole(payload);
      }
    } catch (e) {}
  }

  return (
    <html lang="en">
      <body className={inter.className}>
        <Layout userRole={userRole}>{children}</Layout>
      </body>
    </html>
  );
}