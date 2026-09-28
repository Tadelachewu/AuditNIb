import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 dropped the built-in Rust query engine binary in favor of driver
// adapters: PrismaClient no longer opens a connection from a `url` declared
// in schema.prisma (that field was removed - see schema.prisma's datasource
// block) - it's handed a pre-built adapter that owns a real `pg` connection
// pool instead. This is also why the import above comes from the generated
// output path (prisma/schema.prisma's `generator client { output = ... }`)
// rather than "@prisma/client" - v7 generates a real project-local package,
// not a node_modules shim.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Standard Next.js dev-mode singleton: without this, every hot-reload of a
// module that imports this file would construct a brand-new PrismaClient
// (and its own connection pool) on top of the last one, since Next.js
// re-evaluates modules on save but keeps the Node process alive - a few
// edits in and the dev server exhausts Postgres's connection limit. Stashed
// on `globalThis` (survives module re-evaluation, unlike a plain module-
// scoped variable would if the module itself got re-required) and only in
// non-production, where each deploy is a fresh process anyway and this
// would otherwise leak the client across serverless invocations instead.
//
// The cached client is only reused while it was built from the *same*
// PrismaClient class. `prisma generate` (after a schema change/migration)
// rewrites src/generated/prisma, so the next hot reload evaluates a new
// class - without this check the stale instance on globalThis would keep
// the old data model and reject new columns ("Unknown argument `x`")
// until someone restarted `next dev`.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaClass?: typeof PrismaClient;
};

const cached = globalForPrisma.prismaClass === PrismaClient ? globalForPrisma.prisma : undefined;
if (!cached && globalForPrisma.prisma) {
  // Release the outdated client's connection pool before replacing it.
  void globalForPrisma.prisma.$disconnect().catch(() => {});
}

export const prisma = cached ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaClass = PrismaClient;
}
