-- DropForeignKey
ALTER TABLE "findings" DROP CONSTRAINT "findings_category_fkey";

-- AlterTable
ALTER TABLE "findings" ALTER COLUMN "source_id" DROP NOT NULL,
ALTER COLUMN "department_id" DROP NOT NULL,
ALTER COLUMN "category_id" DROP NOT NULL;
