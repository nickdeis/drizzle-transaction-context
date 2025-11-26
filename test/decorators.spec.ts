import { createTransactionContext, TransactionContext } from "..";
import { initialize as initPg } from "./schema.pg";
import { initialize as initSQLite } from "./schema.sqlite";
import { expect, test, describe } from "bun:test";
import * as g from "./generators";
import { eq } from "drizzle-orm";

type TestDB = Awaited<ReturnType<typeof initPg>>;
function decoratorTestSuite({
  db,
  schema: { customer, order, items },
}: TestDB) {
  const {
    Transactional,
    SavePoint,
    BoundedTxContext,
    useTransaction,
    useSavePoint,
  } = createTransactionContext(db);
  class A extends BoundedTxContext {
    @Transactional
    async insertCustomer() {
      expect(this.inTransactionContext()).toBe(true);
      const tx = this.useTransaction();
      const [result] = await tx
        .insert(customer)
        .values(g.customer())
        .returning({ customer_id: customer.customer_id });
      await this.insertOrder(result!.customer_id);
      return result!.customer_id;
    }
    @SavePoint
    private async insertOrder(customer_id: string) {
      expect(this.inSavePointContext()).toBe(true);
      const sp = useSavePoint();
      const [result] = await sp
        .insert(order)
        .values(g.order(customer_id))
        .returning({ order_id: order.order_id });
      await this.insertItem(result!.order_id);
    }
    @SavePoint("a")
    private async insertItem(order_id: string) {
      expect(this.currentSavePointName()).toBe("a");
      const sp = this.useSavePoint();
      await sp.insert(items).values(g.item(order_id));
    }
  }
  class B {
    @Transactional({ accessMode: "read only" })
    async getCustomer(customer_id: string) {
      const tx = useTransaction();
      const [result] = await tx
        .select()
        .from(customer)
        .where(eq(customer.customer_id, customer_id));
      expect(result).toBeDefined();
      return result;
    }
  }
  const a = new A();
  const b = new B();
  test("Test AOP between classes", async () => {
    const customer_id = await a.insertCustomer();
    await b.getCustomer(customer_id);
  });
}
describe("drizzle-transaction-context", () => {
  describe("Decorators", () => {
    describe("Postgres", async () => {
      const { db, schema } = await initPg();
      decoratorTestSuite({ db, schema });
    });
    describe("SQLite", async () => {
      const payload = await initSQLite();
      decoratorTestSuite(payload as any);
    });
  });
});
