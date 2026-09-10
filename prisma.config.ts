// Prisma 7 no longer reads .env itself or a `url` from schema.prisma - this
// file is what the `prisma` CLI (generate/migrate/studio) reads instead. The
// app's own runtime (Next.js, tsx scripts) still gets DATABASE_URL from
// .env/.env.local the normal way; this file only feeds the CLI.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
