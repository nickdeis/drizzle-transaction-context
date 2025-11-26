import { integer, pgTable, text, real, uuid } from "drizzle-orm/pg-core";
import { pushSchema } from "drizzle-kit/api";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { seed } from "drizzle-seed";

const customer = pgTable("customers", {
  customer_id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  age: integer().notNull(),
  email: text().notNull(),
});

const order = pgTable("orders", {
  customer_id: uuid()
    .references(() => customer.customer_id)
    .defaultRandom(),
  order_id: uuid().primaryKey().defaultRandom(),
  order_total: real().notNull(),
});

const items = pgTable("items", {
  item_id: uuid().primaryKey().defaultRandom(),
  order_id: uuid()
    .references(() => order.order_id)
    .defaultRandom(),
  item_quantity: integer().notNull(),
  item_name: text().notNull(),
});

const schema = { items, order, customer };

export async function initialize() {
  const client = await PGlite.create();
  const db = drizzle({ client, schema });
  const { apply } = await pushSchema(schema, db as any);
  await apply();
  await seed(db as any, schema);
  return { db, schema };
}
