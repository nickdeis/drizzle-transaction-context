const { createTransactionContext } = require("drizzle-transaction-context");

if (typeof createTransactionContext !== "function") {
  throw new Error();
}
