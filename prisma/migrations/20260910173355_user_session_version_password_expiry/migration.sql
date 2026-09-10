-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_expires_at" TIMESTAMP(3),
ADD COLUMN     "session_version" INTEGER NOT NULL DEFAULT 1;
