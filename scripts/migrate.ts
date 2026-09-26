/**
 * Vercel 빌드 단계에서 실행된다 (package.json의 build 스크립트).
 * 배포 환경별 TURSO_DATABASE_URL(prod / preview)에 마이그레이션을 적용한다.
 */
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.warn("[migrate] TURSO_DATABASE_URL이 없어 마이그레이션을 건너뜁니다.");
  process.exit(0);
}

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
console.log("[migrate] 완료");
client.close();
