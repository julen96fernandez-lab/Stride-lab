import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { ServiceWorker } from "@/components/ServiceWorker";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Stride Lab",
  description: "Mi laboratorio de running.",
  applicationName: "Stride Lab",
  appleWebApp: { capable: true, title: "Stride Lab", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0B09",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${inter.variable} ${spaceGrotesk.variable} antialiased`}>
      <body>
        <div className="app-backdrop" aria-hidden="true" />
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
