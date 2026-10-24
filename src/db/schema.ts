import { sql } from "drizzle-orm";
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const shareRole = pgEnum("share_role", ["view", "edit"]);
export const publicAccess = pgEnum("public_access", ["none", "view"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The cookie holds a random token; only its SHA-256 is stored here.
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Pages form a tree through parent_id, like Notion's page blocks whose
// parent_table is "block". Siblings are ordered by a fractional position so a
// page can be moved between two others without renumbering the rest.
export const pages = pgTable(
  "pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => pages.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull().default(""),
    icon: text("icon"),
    position: doublePrecision("position").notNull().default(0),
    publicAccess: publicAccess("public_access").notNull().default("none"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pages_parent_idx").on(t.parentId), index("pages_owner_idx").on(t.ownerId)],
);

// Every block is its own row, as in Notion's record model. Nesting is
// parent_id within the page, ordering is position among siblings. The ids
// come from the editor, so they are only unique within a page.
export const blocks = pgTable(
  "blocks",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    parentId: text("parent_id"),
    position: integer("position").notNull(),
    type: text("type").notNull(),
    props: jsonb("props").notNull().default(sql`'{}'::jsonb`),
    content: jsonb("content"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.id] }), index("blocks_parent_idx").on(t.pageId, t.parentId)],
);

// A share applies to the page and everything below it.
export const pageShares = pgTable(
  "page_shares",
  {
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: shareRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.userId] })],
);
