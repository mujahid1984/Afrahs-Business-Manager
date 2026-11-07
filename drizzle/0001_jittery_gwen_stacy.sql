CREATE TABLE `product_numbers` (
	`number` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_numbers_product_name_unique` ON `product_numbers` (`product_name`);
--> statement-breakpoint
CREATE TRIGGER product_number_on_create
AFTER INSERT ON products
BEGIN
  INSERT INTO product_numbers (product_name) VALUES (NEW.name);
END;
