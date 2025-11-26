[![Build Status](https://github.com/nickdeis/drizzle-transaction-context/actions/workflows/main.yml/badge.svg)](https://github.com/nickdeis/drizzle-transaction-context/actions/workflows/main.yml/badge.svg)
![NPM Version](https://img.shields.io/npm/v/drizzle-transaction-context?style=flat&color=%2389CFF0)

# drizzle-transaction-context

Implicit and execution scoped transactions/savepoints for [drizzle-orm](https://github.com/drizzle-team/drizzle-orm).

Useful for keep transactions from blocking across functions/files/services.

Uses `node:async_hooks`, so this works in bun/deno/node (recommend that you use node 24+ for improved performance)

[Based on this spec by](https://github.com/drizzle-team/drizzle-orm/discussions/2777) @agcty

## Example Usage

```sh
npm i drizzle-transaction-context
```

```ts
import { createTransactionContext } from "drizzle-transaction-context";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";

const sqlite = new Database("");
const db = drizzle({ client: sqlite, schema });
const { useTransaction, withTransaction } = createTransactionContext(db);

async function addCustomerService(name: string, age: number) {
  return withTransaction(async () => {
    await addCustomerWithFixes(string, age);
  });
}

async function addCustomerWithFixes(name: string, age: number) {
  await addCustomer(name);
  await execAgeFix(name, age);
}

async function addCustomer(name: string) {
  const tx = useTransaction();
  await tx.insert(schema.customers).values({ name });
}

async function execAgeFix(name: string, age: number) {
  const tx = useTransaction();
  await tx
    .update(schema.customers)
    .set({ age })
    .where(eq(schema.customer.name, name));
}
```

## Savepoints

Savepoints are supported as well. `withSavePoint` must be called within the execution scope of `withTransaction` (safe mode will handle this for you).

Unlike transactions, savepoints can be nested, so you can call `withSavePoint` within `withSavePoint` with no warning or error.

Because of this, you can "name" your savepoints for logging/debugging

```ts
const {
  useTransaction,
  withTransaction,
  withSavePoint,
  useSavePoint,
  contextDepth,
  currentSavePointName,
} = createTransactionContext(db);

withTransaction(async () => {
  withSavePoint(async () => {
    withSavePoint(async () => {
      savePointNest();
    }, "sp2");
    savePointNest();
  }, "sp1");
});
function savePointNest() {
  const sp = useSavePoint();
  const depth = contextDepth();
  const name = currentSavePointName();
  console.log(name, depth);
}
//"sp2" 3
//"sp1" 2
```

## AOP/Service Oriented

Big Spring fan? I gotchu:

You can initialize a transaction scope with `@Transactional` and a savepoint scope with `@SavePoint`.

```ts
const { Transactional, SavePoint, useTransaction, useSavePoint } =
  createTransactionContext(db);
class A {
  @Transactional
  async insertCustomer() {
    const tx = useTransaction();
    const [result] = await tx
      .insert(customer)
      .values(g.customer())
      .returning({ customer_id: customer.customer_id });
    await this.insertOrder(result!.customer_id);
    return result!.customer_id;
  }
  @SavePoint
  private async insertOrder(customer_id: string) {
    const sp = useSavePoint();
    const [result] = await sp
      .insert(order)
      .values(g.order(customer_id))
      .returning({ order_id: order.order_id });
    await this.insertItem(result!.order_id);
  }
  @SavePoint("a")
  private async insertItem(order_id: string) {
    const sp = useSavePoint();
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
    return result;
  }
}
const a = new A();
const b = new B();
const customer_id = await a.insertCustomer();
await b.getCustomer(customer_id);
```

## Safe Mode

Safe mode handles common mistakes when working with transactions and log a stack trace to help remediate the issue.

By default, this option is set to `false`.

This is useful when you initially use this library and mix it with other data accessing functionality.

If not in safe mode, these will be thrown as errors.

It is **highly recommended** that you fix these issues before deploying or merging code.

These include:

- Calling `withTransaction` within another `withTransaction` execution scope
- Calling `withSavePoint` outside of a `withTransaction` execution scope
- Calling `useTransaction` outside of a `withTransaction` execution scope
- Calling `useSavePoint` outside of a `withSavePoint` execution scope

## API

### createTransactionContext(`db`,`options?`): `TransactionContext`

Creates a new transaction context. This context can be used for multiple transactions as long as they don't overlap in execution.

Accepts any drizzle driver that supports transactions (currently Postgres-like, MySQL-like, and SQLite-like).

#### options

Both options default to `false`

- safeMode: Enables safe mode as explained above
- silent: If enabled, will turn off warning logs from `safeMode`. I highly recommend not doing this permanently.

### TransactionContext

#### **withTransaction**\<`X`\>(`exec`, `config?`): `Promise`\<`X`\>

Creates a new transaction scope, so `useTransaction` will return within it's execution scope
If in safe mode, another call of `withTransaction` within `withTransaction` will simply execute
within that scope.
In normal mode, it will throw a `AlreadyRunningTransactionError`.

`config` is the same as drizzles transaction config options

---

#### **useTransaction**(): `Transaction` \| `Database`

Returns the currently scoped transaction.

In safe mode, if there is no running transaction, this will return the database object.

In normal mode, it will throw a `NoRunningTransactionError`

---

#### **inTransactionContext**(): `boolean`

True if in a `withTransaction` scope, false if otherwise

---

#### **withSavePoint**\<`Y`\>(`exec`, `savepointName?`): `Promise`\<`Y`\>

Creates a new execution scope for a savepoint

Calling this in another savepoint creates a nested savepoint

You can give the savepoint a name, but this is only used externally via this API for things like logging.

---

#### **useSavePoint**(): `SavePoint` | `Transaction` | `Database`

Returns the currently in scope savepoint.

In safe mode, if no savepoint is present, this function will call `useTransaction` to returning the currently in scope transaction.

This means that it's possible that it will return the database object instead and log two warnings.

---

#### **inSavePointContext**(): `boolean`

true if in a safepoint context, false if otherwise

---

#### **currentSavePointName**(): `string` \| `undefined`

Returns the name of the save point if it was given in `withSavePoint`.
Useful for debugging and logging

---

#### **contextDepth**(): `number`

Gives the current context depth, useful for logging and debugging.

Transaction scoped execution will return 1 always and savepoints will nested continuously
eg: If you are in a save point in save point, this will be 3

---
