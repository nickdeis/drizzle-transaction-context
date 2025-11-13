import {
  AlreadyRunningTransactionError,
  createTransactionContext,
  NoRunningTransactionError,
} from "..";
import { initialize as initPg } from "./schema.pg";
import { initialize as initSQLite } from "./schema.sqlite";
import { expect, test, describe } from "bun:test";
import { eq } from "drizzle-orm";

type TestDB = Awaited<ReturnType<typeof initPg>>;

function dbTestSuite({ db, schema: { customer } }: TestDB) {
  const normalMode = createTransactionContext(db);
  const safeMode = createTransactionContext(db, { safeMode: true });
  type TransactionCtx = typeof normalMode;
  function createFunctionNest({
    withTransaction,
    useTransaction,
    inTransactionContext,
  }: TransactionCtx) {
    async function topLevel() {
      return await withTransaction(async () => {
        return await nextLevel();
      });
    }
    async function nextLevel() {
      const tx = useTransaction();
      await tx.insert(customer).values({
        name: "Nick Deis",
        email: "nickjdeis@gmail.com",
        age: 34,
      });
      expect(inTransactionContext()).toBe(true);
      const customer_id = await bottomLevel();
      const [result] = await tx
        .select({ age: customer.age })
        .from(customer)
        .where(eq(customer.customer_id, customer_id));
      return { age: result!.age, customer_id };
    }
    async function bottomLevel() {
      const tx = useTransaction();
      const [result] = await tx
        .select()
        .from(customer)
        .where(eq(customer.name, "Nick Deis"));

      await tx
        .update(customer)
        .set({ age: 35 })
        .where(eq(customer.customer_id, result!.customer_id));
      return result!.customer_id;
    }
    return topLevel;
  }
  function transactionContextTestSuite(
    ctx: TransactionCtx,
    isSafeMode: boolean = false
  ) {
    test("Should handle nested functions", async () => {
      const nest = createFunctionNest(ctx);
      const result = await nest();
      expect(result.age).toBe(35);
      const [record] = await db
        .select()
        .from(customer)
        .where(eq(customer.customer_id, result.customer_id));
      expect(record).toBeDefined();
    });
    async function captureWarningTrace(testFn: () => Promise<void>) {
      const originalWarn = console.warn;
      let warningTrace: Error | undefined;
      console.warn = (...args) => {
        const arg0 = args[0];
        if (arg0 instanceof Error) {
          warningTrace = arg0;
        }
        originalWarn(...args);
      };
      await testFn();
      console.warn = originalWarn;
      return warningTrace;
    }

    async function captureError(testFn: () => Promise<void>) {
      try {
        await testFn();
      } catch (err) {
        return err as Error;
      }
    }

    const fnWrap = isSafeMode ? captureWarningTrace : captureError;

    test("It should throw an error or print a warning when accessing useTransaction outside of a transaction scope", async () => {
      const testFn = async () => {
        const tx = ctx.useTransaction();
        await tx.select().from(customer).limit(5);
      };
      const result = await fnWrap(testFn);
      if (!result) {
        expect(result).toBeDefined();
        return;
      }
      expect(result).toBeInstanceOf(NoRunningTransactionError);
      if (isSafeMode) {
        expect(result.message).toMatch("the Database");
      }
    });

    test("It should throw an error or print a warning when accessing withTransaction in a withTransaction scope", async () => {
      const childFn = () => {
        return ctx.withTransaction(async () => {});
      };
      const testFn = () => {
        return ctx.withTransaction(async () => {
          return await childFn();
        });
      };
      const result = await fnWrap(testFn);
      if (!result) {
        expect(result).toBeDefined();
        return;
      }
      expect(result).toBeInstanceOf(AlreadyRunningTransactionError);
      if (isSafeMode) {
        expect(result.message).toMatch(
          "Executing this function within the call stack with the same transaction"
        );
      }
    });
    test("Save point depth and name resolve correctly in nests", async () => {
      async function testFn() {
        await ctx.withTransaction(async () => {
          await ctx.withSavePoint(async () => {
            await ctx.withSavePoint(async () => {
              levelThree();
            }, "sp2");
            levelTwo();
          }, "sp1");
          levelOne();
        });
        groundFloor();
      }
      function groundFloor() {
        expect(ctx.inTransactionContext()).toBe(false);
      }

      function levelOne() {
        expect(ctx.inSavePointContext()).toBe(false);
        expect(ctx.inTransactionContext()).toBe(true);
      }

      function levelTwo() {
        const sp = ctx.useSavePoint();
        const depth = ctx.contextDepth();
        const name = ctx.currentSavePointName();
        expect(ctx.inSavePointContext()).toBe(true);
        expect(sp).toBeDefined();
        expect(depth).toBe(2);
        expect(name).toBe("sp1");
      }
      function levelThree() {
        const sp = ctx.useSavePoint();
        const depth = ctx.contextDepth();
        const name = ctx.currentSavePointName();
        expect(ctx.inSavePointContext()).toBe(true);
        expect(sp).toBeDefined();
        expect(depth).toBe(3);
        expect(name).toBe("sp2");
      }
      await testFn();
    });
  }
  describe("Normal mode", () => {
    transactionContextTestSuite(normalMode);
  });

  describe("Safe mode", () => {
    transactionContextTestSuite(safeMode, true);
  });
}

describe("drizzle-transaction-context", () => {
  describe("Postgres", async () => {
    const { db, schema } = await initPg();
    dbTestSuite({ db, schema });
  });
  describe("SQLite", async () => {
    const payload = await initSQLite();
    dbTestSuite(payload as any);
  });
});
