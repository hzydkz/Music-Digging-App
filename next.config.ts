import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cheerio와 libsql은 서버 번들에서 외부 패키지로 둔다.
  serverExternalPackages: ["@libsql/client"],
};

export default nextConfig;
