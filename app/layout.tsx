import "./globals.css";

export const metadata = {
  title: "Dietetyq",
};

/**
 * `viewport-fit: cover` wpuszcza tło pod pasek domowy iPhone'a, żeby widok nie kończył się
 * białą (a u nas: jasną) listwą. Warunek jest jeden i jest spełniony w globals.css: wszystko,
 * co przylega do krawędzi, musi doliczać `env(safe-area-inset-*)` — bez tego `cover` wsuwa
 * przyciski pod pasek domowy, zamiast tylko tło.
 */
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: "#0a0a14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
