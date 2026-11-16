import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createCompanyForUser, createManualTransaction, createOpening } from "../src/lib/server/books";
import { closeDb, getDb } from "../src/lib/server/db/client";
import { users } from "../src/lib/server/db/schema";
import { loadLedger } from "../src/lib/server/reports";

const databaseUrl = process.env.DATABASE_URL;
describe.skipIf(!databaseUrl)("posted books", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("posts a balanced sale and expense through Postgres", async () => {
    const db = getDb();
    await migrate(db, { migrationsFolder: "drizzle" });
    const email = `books-${crypto.randomUUID()}@example.com`;
    const [user] = await db.insert(users).values({ email, name: "Books test" }).returning();

    try {
      await db.transaction(async (tx) => {
        const company = await createCompanyForUser(tx, { userId: user.id, name: "Integration Co" });
        const { statements, journal } = await (async () => {
          const chart = await import("../src/lib/server/db/schema");
          const { accounts: accountTable, categories } = chart;
          const accountRows = await tx.select().from(accountTable).where(eq(accountTable.companyId, company.id));
          const categoryRows = await tx.select().from(categories).where(eq(categories.companyId, company.id));
          const cash = accountRows.find((row) => row.code === "1100");
          const capital = accountRows.find((row) => row.code === "3000");
          const sales = categoryRows.find((row) => row.name === "Sales");
          const meals = categoryRows.find((row) => row.name === "Meals and entertainment");
          if (!cash || !capital || !sales || !meals) throw new Error("starter chart missing");
          await createOpening(tx, {
            companyId: company.id,
            userId: user.id,
            accountId: cash.id,
            asOf: "2024-01-01",
            side: "debit",
            amount: "10000.00",
            note: "test"
          });
          await createOpening(tx, {
            companyId: company.id,
            userId: user.id,
            accountId: capital.id,
            asOf: "2024-01-01",
            side: "credit",
            amount: "10000.00",
            note: "test"
          });
          await createManualTransaction(tx, {
            companyId: company.id,
            userId: user.id,
            type: "sales",
            settlementAccountId: cash.id,
            categoryId: sales.id,
            txnDate: "2024-02-01",
            merchant: "Walk-in",
            description: "February sale",
            amount: "500.00"
          });
          await createManualTransaction(tx, {
            companyId: company.id,
            userId: user.id,
            type: "expense",
            settlementAccountId: cash.id,
            categoryId: meals.id,
            txnDate: "2024-02-02",
            merchant: "Cafe",
            description: "Lunch",
            amount: "80.00"
          });
          return loadLedger(tx, company.id, "2024-01-01", "2024-12-31");
        })();

        expect(journal).toHaveLength(4);
        expect(statements.profitAndLoss.netIncomeCents).toBe(42000);
        expect(statements.balanceSheet.balanceCheckCents).toBe(0);
        expect(statements.totals.balanced).toBe(true);
        throw new Error("rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rollback") throw error;
    } finally {
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
