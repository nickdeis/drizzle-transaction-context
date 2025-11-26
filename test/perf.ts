import { initialize as initPg } from "./schema.pg";
import { initialize as initSQLite } from "./schema.sqlite";
import * as g from "./generators";
import { expect, test, describe } from "bun:test";
import { createTransactionContext } from "..";
import type { ExtractTransaction, TransactionContext } from "..";
import { faker } from "@faker-js/faker";
type TestDB = Awaited<ReturnType<typeof initPg>>;
type XAsync = (...args: any[]) => Promise<void>;
function repeat<X>(n: number, fn: (...args: any[]) => X) {
  return Array(n).fill(0).map(fn);
}
async function repeatAsync<T extends XAsync>(n: number, fn: T) {
  return await Promise.all(Array(n).fill(0).map(fn));
}

type InitDBFn = typeof initPg;

function performanceInnerSuite({
  db,
  schema: { customer, order, items },
}: TestDB) {
  const { withTransaction, useTransaction } = createTransactionContext(db);
  async function startContext() {
    const times: number[] = [];
    await withTransaction(async () => {
      await repeatAsync(1000, async () => {
        const startTime = Date.now();
        await insertCustomer();
        times.push(Date.now() - startTime);
      });
    });
    times.sort();
    return times[500];
  }
  async function startClassic() {
    const times: number[] = [];
    await db.transaction(async (tx) => {
      await repeatAsync(1000, async () => {
        const startTime = Date.now();
        await insertCustomer(tx);
        times.push(Date.now() - startTime);
      });
    });
    times.sort();
    return times[500];
  }
  type Tx = ExtractTransaction<typeof db>;
  async function insertCustomer(txn?: Tx) {
    const tx = txn ? txn : useTransaction();
    const [result] = await tx
      .insert(customer)
      .values(g.customer())
      .returning({ customer_id: customer.customer_id });
    await repeatAsync(
      5,
      async () => await insertOrders(result!.customer_id, txn)
    );
  }
  async function insertOrders(customer_id: string, txn?: Tx) {
    const tx = txn ? txn : useTransaction();
    const [result] = await tx
      .insert(order)
      .values(g.order(customer_id))
      .returning({ order_id: order.order_id });
    await repeatAsync(10, async () => await insertItems(result!.order_id, txn));
  }
  async function insertItems(order_id: string, txn?: Tx) {
    const tx = txn ? txn : useTransaction();
    await tx.insert(items).values(g.item(order_id));
  }
  return { startClassic, startContext };
}

function performanceTestSuite(initDB: InitDBFn, dbName: string) {
  const classic = async () => {
    const init = await initDB();
    const time = await performanceInnerSuite(init).startClassic();
    console.log(
      `${dbName} Classic Transactions median transaction time: ${time}ms`
    );
  };
  const context = async () => {
    const init = await initDB();
    const time = await performanceInnerSuite(init).startContext();
    console.log(
      `${dbName} Context Transactions median transaction time: ${time}ms`
    );
  };
  return { classic, context };
}

function dbTestSuite() {
  const postgres = performanceTestSuite(initPg, "Postgres");
  const sqlite = performanceTestSuite(initSQLite as any, "SQLite");
  return { postgres, sqlite };
}
declare var self: Worker;

type RunData = {
  db: "postgres" | "sqlite";
  tx: "classic" | "context";
};

if (Bun.isMainThread) {
  ["postgres", "sqlite"].forEach((db) => {
    ["classic", "context"].forEach((tx) => {
      const worker = new Worker(__filename);
      worker.postMessage({ db, tx });
    });
  });
} else {
  const runners = dbTestSuite();
  self.onmessage = async (event: MessageEvent<RunData>) => {
    const { db, tx } = event.data;
    await runners[db][tx]();
    process.exit(0);
  };
}
