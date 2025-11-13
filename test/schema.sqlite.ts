import { int, sqliteTable, text, blob, real } from "drizzle-orm/sqlite-core";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { seed } from "drizzle-seed";

const customer = sqliteTable("customers", {
  customer_id: int().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  age: int().notNull(),
  email: text().notNull(),
});

const order = sqliteTable("orders", {
  customer_id: int().references(() => customer.customer_id),
  order_id: int().primaryKey({ autoIncrement: true }),
  order_total: real().notNull(),
});

const items = sqliteTable("items", {
  item_id: int().primaryKey({ autoIncrement: true }),
  order_id: int().references(() => order.order_id),
  item_quantity: int().notNull(),
  item_name: text(),
});

const schema = { items, order, customer };

export async function initialize() {
  const sqlite = new Database("");
  const db = drizzle({ client: sqlite, schema });
  const { apply } = await pushSQLiteSchema(schema, db as any);
  await apply();
  await seed(db as any, schema);
  return { db, schema };
}
