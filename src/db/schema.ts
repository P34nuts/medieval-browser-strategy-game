/**
 * Datenbankschema (PostgreSQL via Drizzle ORM).
 *
 *  - users:    Spieler-Accounts (Passwort als scrypt-Hash, niemals im Klartext)
 *  - sessions: Login-Sitzungen (nur der SHA-256-Hash des Tokens wird gespeichert)
 *  - saves:    Ein Spielstand pro Account (kompaktes JSON; die Karte wird aus dem Seed neu erzeugt)
 */
import { integer, jsonb, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 32 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
});

export const saves = pgTable("saves", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data").notNull(),
  level: integer("level").notNull().default(1),
  population: integer("population").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
