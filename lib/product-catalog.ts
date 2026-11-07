import type {Product} from './business';

export const assignMissingProductNumbersSql = `
  INSERT OR IGNORE INTO product_numbers (product_name)
  SELECT p.name FROM products p
  WHERE NOT EXISTS (
    SELECT 1 FROM product_numbers n WHERE n.product_name = p.name
  )
  ORDER BY p.name COLLATE NOCASE, p.name
`;

export async function assignMissingProductNumbers(database: D1Database) {
  await database.prepare(assignMissingProductNumbersSql).run();
}

export async function readProductCatalog(database: D1Database) {
  await assignMissingProductNumbers(database);

  const products = await database.prepare(`
    SELECT p.name, p.cost, p.offset,
      'AFR-PRD-' || printf('%04d', n.number) AS productId
    FROM products p
    JOIN product_numbers n ON n.product_name = p.name
    ORDER BY p.name
  `).all<Product>();
  const sequence = await database.prepare(`
    SELECT COALESCE(
      (SELECT seq FROM sqlite_sequence WHERE name='product_numbers'), 0
    ) AS lastNumber
  `).first<{lastNumber: number}>();

  return {
    products: products.results,
    nextProductId: 'AFR-PRD-' + String((sequence?.lastNumber || 0) + 1).padStart(4, '0'),
  };
}
