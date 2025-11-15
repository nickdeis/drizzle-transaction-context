import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import { AsyncLocalStorage } from "node:async_hooks";
import type {
  MySqlQueryResultHKT,
  PreparedQueryHKTBase,
  MySqlDatabase,
} from "drizzle-orm/mysql-core";

type BSchema = Record<string, unknown>;

type PGDB<TSchema extends BSchema> = PgDatabase<
  PgQueryResultHKT,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>;
type SQLiteDB<
  TSchema extends BSchema,
  TRunResult = unknown
> = BaseSQLiteDatabase<
  "async" | "sync",
  TRunResult,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>;

type MYSQLDB<TSchema extends BSchema> = MySqlDatabase<
  MySqlQueryResultHKT,
  PreparedQueryHKTBase,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>;

type DB<TSchema extends BSchema, SQLiteRunResult = unknown> =
  | PGDB<TSchema>
  | MYSQLDB<TSchema>
  | SQLiteDB<TSchema, SQLiteRunResult>;

type HasTransaction = { transaction: (...args: any[]) => any };

type ExtractTransaction<X extends HasTransaction> = Parameters<
  Parameters<X["transaction"]>[0]
>[0];

type ExtractTransactionConfig<
  X extends DB<TSchema>,
  TSchema extends BSchema
> = Parameters<X["transaction"]>[1];

export type TransactionContextOptions = {
  /**
   * Safe mode will try to prevent common issues with transactions and scoped execution in general.
   *
   * By default this is set to `false`
   *
   * It handles the following situations (read the docs for more details on how each of these cases are handled)
   *
   * - Calling `withTransaction` within another `withTransaction` execution scope
   * - Calling `withSavePoint` outside of a `withTransaction` execution scope
   * - Calling `useTransaction` outside of a `withTransaction` execution scope
   * - Calling `useSavePoint` outside of a `withSavePoint` execution scope
   */
  safeMode?: boolean;
  /**
   * Turns off warning logs in safe mode (**not recommended**)
   *
   * By default, this is `false`
   */
  silent?: boolean;
};

const DEFAULT_OPTIONS: TransactionContextOptions = {
  safeMode: false,
  silent: false,
};

export class DrizzleTransactionContextError extends Error {
  name = "DrizzleTransactionContextError";
  constructor(
    errorMessage: string,
    warningMessage: string,
    safeMode: boolean = false
  ) {
    super(errorMessage + (safeMode ? " " + warningMessage : ""));
  }
}

export class AlreadyRunningTransactionError extends DrizzleTransactionContextError {
  name = "AlreadyRunningTransactionError";
  constructor(safeMode?: boolean) {
    super(
      `You are calling "withTransaction" within a "withTransaction" call stack.`,
      `Executing this function within the call stack with the same transaction`,
      safeMode
    );
  }
}

export class NoRunningTransactionError extends DrizzleTransactionContextError {
  name = "NoRunningTransactionError";
  constructor(
    safeMode?: boolean,
    errMsg = `You are calling "useTransaction" outside of a "withTransaction" call stack.`,
    warningMsg = `Returning the Database object instead, which can handle the same methods.`
  ) {
    super(errMsg, warningMsg, safeMode);
  }
  static useTransactionError(safeMode?: boolean) {
    return new NoRunningTransactionError(safeMode);
  }
  static withSavePointError(safeMode?: boolean) {
    return new NoRunningTransactionError(
      safeMode,
      `You are calling "withSavePoint" outside of "withTransaction" call stack.`,
      `Calling "withTransaction" and then calling "withSavePoint" to execute within that stack`
    );
  }
}

export class NoRunningSavePointError extends DrizzleTransactionContextError {
  name = "NoRunningSavePointError";
  constructor(safeMode?: boolean) {
    super(
      `You are calling 'useSavePoint' outside of the 'withSavePoint' call stack.`,
      `Returning the Transaction object instead, which can handle the same methods.`,
      safeMode
    );
  }
}
/**
 * Creates a new transaction context. This context can be used for multiple transactions as long as they don't overlap in execution (safe mode will handle this by executing them together)
 *
 * Accepts any drizzle driver that supports transactions (currently Postgres-like, MySQL-like, and SQLite-like).
 *
 * `options` currently has two fields (both of which default to `false`):
 *
 * - `safeMode`: Enables "safe mode"
 * - `silent`: Turns off warning logs in "safe mode" (**not recommended**)
 *
 * See {@link TransactionContextOptions}
 */
export function createTransactionContext<
  TDB extends SQLiteDB<TSchema, SQLiteRunResult>,
  TSchema extends BSchema,
  SQLiteRunResult
>(
  db: TDB,
  options?: TransactionContextOptions
): Methods<TransactionContext<TSchema, TDB, SQLiteRunResult>>;
export function createTransactionContext<
  TDB extends MYSQLDB<TSchema>,
  TSchema extends BSchema
>(
  db: TDB,
  options?: TransactionContextOptions
): Methods<TransactionContext<TSchema, TDB>>;
export function createTransactionContext<
  TDB extends PGDB<TSchema>,
  TSchema extends BSchema
>(
  db: TDB,
  options?: TransactionContextOptions
): Methods<TransactionContext<TSchema, TDB>>;
export function createTransactionContext<
  TDB extends DB<TSchema, SQLiteRunResult>,
  TSchema extends BSchema,
  SQLiteRunResult = unknown
>(
  db: TDB,
  options: TransactionContextOptions = DEFAULT_OPTIONS
): Methods<TransactionContext<TSchema, TDB, SQLiteRunResult>> {
  const {
    inTransactionContext,
    useTransaction,
    withTransaction,
    contextDepth,
    currentSavePointName,
    useSavePoint,
    withSavePoint,
    inSavePointContext,
  } = new TransactionContext<TSchema, TDB, SQLiteRunResult>(db, options);
  return {
    inTransactionContext,
    useTransaction,
    withTransaction,
    contextDepth,
    currentSavePointName,
    useSavePoint,
    withSavePoint,
    inSavePointContext,
  };
}

type ITransactionStorage<TDB extends DB<TSchema>, TSchema extends BSchema> = {
  tx?: ExtractTransaction<TDB>;
  savepoint?: ExtractTransaction<TDB>;
  savepointName?: string;
  depth: number;
};

export class TransactionContext<
  TSchema extends BSchema,
  TDB extends DB<TSchema, SQLiteRunResult>,
  SQLiteRunResult = unknown
> {
  private readonly storage: AsyncLocalStorage<
    ITransactionStorage<TDB, TSchema>
  >;
  private getStore = (): ITransactionStorage<TDB, TSchema> => {
    return this.storage.getStore() || { depth: 0 };
  };
  constructor(
    private readonly db: TDB,
    private readonly options: TransactionContextOptions = DEFAULT_OPTIONS
  ) {
    this.storage = new AsyncLocalStorage({ defaultValue: { depth: 0 } });
  }
  /**
   * Creates a new transaction scope, so {@link useTransaction} will return within it's execution scope
   *
   * If in safe mode, another call of {@link withTransaction} within {@link withTransaction} will simply execute
   * within the original transaction scope.
   *
   * In normal mode, it will throw a {@link AlreadyRunningTransactionError}.
   *
   * `config` is the same as drizzles transaction config options for MySQL, Postgres, and SQLite
   *
   */
  withTransaction = async <X>(
    exec: () => Promise<X>,
    config?: ExtractTransactionConfig<TDB, TSchema>
  ): Promise<X> => {
    const { tx: tnx } = this.getStore();
    if (tnx) {
      const err = new AlreadyRunningTransactionError(this.options.safeMode);
      if (this.options.safeMode) {
        this.logWarning(err);
        return await exec();
      } else {
        throw err;
      }
    }
    return this.db.transaction((tx) => {
      return this.storage.run({ tx, depth: 1 }, async () => {
        return await exec();
      });
    }, config as any);
  };
  /**
   * Returns the currently scoped transaction.
   *
   * In safe mode, if there is no running transaction, this will return the database object.
   *
   * In normal mode, it will throw a {@link NoRunningTransactionError}
   */
  useTransaction = () => {
    const { tx } = this.getStore();
    if (!tx) {
      const err = NoRunningTransactionError.useTransactionError(
        this.options.safeMode
      );
      if (this.options.safeMode) {
        this.logWarning(err);
        return this.db;
      } else {
        throw err;
      }
    }
    return tx;
  };
  /**
   * @returns True if in a `withTransaction` scope, false if otherwise
   */
  inTransactionContext = () => {
    const { tx } = this.getStore();
    return !!tx;
  };
  /**
   * Creates a new execution scope for a savepoint
   *
   * Calling this in another savepoint creates a nested savepoint
   *
   * You can give the savepoint a name, but this is only used externally via this API for things like logging.
   *
   * throws {@link NoRunningTransactionError} when initialized outside of a `withTransaction` scope and not in safemode
   *
   * If safemode is on, will initialize a new transaction scope
   */
  withSavePoint = async <Y>(
    exec: () => Promise<Y>,
    savepointName?: string
  ): Promise<Y> => {
    const { savepoint: existingSavepoint, depth, tx } = this.getStore();
    if (!tx) {
      const err = NoRunningTransactionError.withSavePointError(
        this.options.safeMode
      );
      if (!this.options.safeMode) throw err;
      this.logWarning(err);
      return this.withTransaction(async () => {
        return this.withSavePoint(exec, savepointName);
      });
    }
    const wrappingTx = existingSavepoint || tx;
    return wrappingTx.transaction(async (savepoint) => {
      return this.storage.run(
        { savepoint, savepointName, depth: depth + 1, tx },
        () => {
          return exec();
        }
      );
    });
  };
  /**
   * Gives the current context depth, useful for logging and debugging.
   *
   * Transaction scoped execution will return 1 always and savepoints will nested continuously
   * eg: If you are in a save point in save point, this will be 3
   */
  contextDepth = () => {
    const { depth } = this.getStore();
    return depth;
  };
  /**
   * Returns the name of the save point if it was given in {@link withSavePoint}.
   * Useful for debugging and logging
   */
  currentSavePointName = () => {
    const { savepointName } = this.getStore();
    return savepointName;
  };
  /**
   *
   * @returns true if in a safepoint context, false if otherwise
   */
  inSavePointContext = () => {
    const { savepoint } = this.getStore();
    return !!savepoint;
  };
  private logWarning = (err: DrizzleTransactionContextError) => {
    if (!this.options.silent) {
      console.warn(err);
    }
  };
  /**
   * Returns the currently in scope savepoint.
   *
   * In safe mode, if no savepoint is present, this function will call {@link useTransaction} to returning the currently in scope transaction.
   *
   * This means that it's possible that it will return the database object instead and log two warnings.
   *
   * throws {@link NoRunningSavePointError} If called outside of a savepoint context with safe mode off
   */
  useSavePoint = () => {
    const { savepoint } = this.getStore();
    if (!savepoint) {
      const err = new NoRunningSavePointError(this.options.safeMode);
      if (this.options.safeMode) {
        this.logWarning(err);
        return this.useTransaction();
      } else {
        throw err;
      }
    }
    return savepoint;
  };
}

type PublicMethodNames<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? K : never;
}[keyof T];

// Extracts a type with only the public methods
type Methods<T> = Pick<T, PublicMethodNames<T>>;
