import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { dbFromClient } from "@/db/client";

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")) as T;
}

/** 임시 파일 SQLite에 마이그레이션을 적용한 DB (트랜잭션 때문에 :memory: 대신 파일 사용) */
export async function testDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "digging-test-"));
  const client = createClient({ url: `file:${path.join(dir, "t.db")}` });
  await migrate(drizzle(client), { migrationsFolder: path.join(import.meta.dirname, "..", "drizzle") });
  return {
    db: dbFromClient(client),
    cleanup: () => {
      client.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
