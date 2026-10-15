import { MongoClient, type Collection } from "mongodb";
import { config } from "../config";
import { AppError } from "../errors";
import type { MemoryStore } from "../ports";
import type { MemoryRecord } from "../types";

let client: MongoClient | undefined;
let connecting: Promise<void> | undefined;

/**
 * Opens the Atlas client once. A second call waits for the first attempt
 * instead of replacing the live client.
 */
export function connectMongo(): Promise<void> {
  if (client) {
    return Promise.resolve();
  }
  if (connecting) {
    return connecting;
  }
  connecting = openClient().finally(() => {
    connecting = undefined;
  });
  return connecting;
}

async function openClient(): Promise<void> {
  const next = new MongoClient(config.mongoUri);
  try {
    await next.connect();
    await next.db(config.mongoDbName).collection<MemoryRecord>("memories").createIndex({ createdAt: -1 });
    client = next;
  } catch (error) {
    await next.close().catch(() => undefined);
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`MongoDB connection failed: ${message}`);
    throw new AppError(503, "MONGO_UNAVAILABLE", "Could not connect to MongoDB Atlas");
  }
}

/**
 * Closes the client if one is open. Safe to call during shutdown more than once.
 */
export async function closeMongo(): Promise<void> {
  if (!client) {
    return;
  }
  const current = client;
  client = undefined;
  await current.close();
}

function memories(): Collection<MemoryRecord> {
  if (!client) {
    throw new AppError(503, "MONGO_UNAVAILABLE", "MongoDB is not connected");
  }
  return client.db(config.mongoDbName).collection<MemoryRecord>("memories");
}

/**
 * Atlas-backed memory store. The process owns the client; this class only uses it.
 */
export class MongoMemoryStore implements MemoryStore {
  /**
   * Inserts one card. Database errors are logged and replaced with a stable client message.
   *
   * @param record - Finished memory. `photoPath` is a relative media path.
   */
  async save(record: MemoryRecord): Promise<void> {
    try {
      await memories().insertOne(record);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`MongoDB write failed: ${message}`);
      throw new AppError(503, "MONGO_WRITE_FAILED", "Could not save the memory");
    }
  }

  /**
   * @returns True when the server answers a ping. False when the client is absent or the ping fails.
   */
  async ping(): Promise<boolean> {
    if (!client) {
      return false;
    }
    try {
      await client.db(config.mongoDbName).command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Inserts with the process-wide store. Prefer injecting `MemoryStore` in new code.
 *
 * @param record - Finished memory card.
 */
export async function saveMemory(record: MemoryRecord): Promise<void> {
  await new MongoMemoryStore().save(record);
}
