import type { BenchmarkEntry } from "../types.js";
import { StorageService } from "./storage-service.js";

export class BenchmarkRepository {
  constructor(private readonly storage: StorageService) {}

  read(): BenchmarkEntry[] {
    return this.storage.readBenchmark();
  }

  add(entry: BenchmarkEntry): BenchmarkEntry[] {
    const entries = this.read();
    entries.push(entry);
    this.storage.saveBenchmark(entries);
    return entries;
  }

  clear(): void {
    this.storage.clearBenchmark();
  }
}
