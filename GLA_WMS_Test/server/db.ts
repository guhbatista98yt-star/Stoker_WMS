import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "@shared/schema";

const client = createClient({
    url: "file:database.db",
});

export const db = drizzle(client, { schema });

// Enable WAL mode and set busy timeout to handle concurrent access
db.$client.execute("PRAGMA journal_mode = WAL");
db.$client.execute("PRAGMA busy_timeout = 5000"); // 5 seconds timeout
