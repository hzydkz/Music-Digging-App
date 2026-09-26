import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;

let cached: { client: Client; db: DB } | null = null;

export function getDb(): DB {
  if (cached) return cached.db;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL 환경변수가 설정되지 않았습니다.");
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  cached = { client, db: drizzle(client, { schema }) };
  return cached.db;
}

/** 테스트용: 임의의 libsql 클라이언트로 DB 인스턴스를 만든다. */
export function dbFromClient(client: Client): DB {
  return drizzle(client, { schema });
}
