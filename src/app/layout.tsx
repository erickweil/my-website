import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import LiveTitle from "@/components/live-title";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR" 
      suppressHydrationWarning
      className={cn("antialiased", geistMono.variable, "font-sans", geistSans.variable)}
      >
      <head>
        <LiveTitle />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
