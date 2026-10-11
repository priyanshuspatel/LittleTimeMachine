import { MongoClient, type Collection } from "mongodb";
import { config } from "../config";
import { AppError } from "../errors";
import type { MemoryRecord } from "../types";

let client: MongoClient | undefined;

export async function connectMongo(): Promise<void> {
  client = new MongoClient(config.mongoUri);
  try {
    await client.connect();
    await memories().createIndex({ createdAt: -1 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`MongoDB connection failed: ${message}`);
    throw new AppError(503, "MONGO_UNAVAILABLE", "Could not connect to MongoDB Atlas");
  }
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = undefined;
  }
}

function memories(): Collection<MemoryRecord> {
  if (!client) {
    throw new AppError(503, "MONGO_UNAVAILABLE", "MongoDB is not connected");
  }
  return client.db(config.mongoDbName).collection<MemoryRecord>("memories");
}

export async function saveMemory(record: MemoryRecord): Promise<void> {
  try {
    await memories().insertOne(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`MongoDB write failed: ${message}`);
    throw new AppError(503, "MONGO_WRITE_FAILED", "Could not save the memory");
  }
}
