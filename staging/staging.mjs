import { createTransactionContext } from "drizzle-transaction-context";

if (typeof createTransactionContext !== "function") {
  throw new Error();
}
