import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const records=sqliteTable('records',{id:text('id').primaryKey(),kind:text('kind').notNull(),date:text('date').notNull(),item:text('item').notNull(),market:text('market').notNull(),quantity:integer('quantity').notNull(),unitCost:integer('unit_cost').notNull(),amount:integer('amount').notNull(),originalDate:text('original_date').notNull(),note:text('note').notNull(),actor:text('actor').notNull(),createdAt:text('created_at').notNull()});
export const products=sqliteTable('products',{name:text('name').primaryKey(),cost:integer('cost').notNull(),offset:integer('offset').notNull().default(0)});
export const settings=sqliteTable('settings',{key:text('key').primaryKey(),value:text('value').notNull()});

export const productNumbers = sqliteTable('product_numbers', {
  number: integer('number').primaryKey({autoIncrement: true}),
  productName: text('product_name').notNull().unique(),
});
