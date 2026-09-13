import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // W katalogu domowym leży osobny package-lock.json i bez tego Next brał go za korzeń
  // workspace'u. Przypięcie do katalogu projektu daje ten sam wynik lokalnie i na serwerze.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
